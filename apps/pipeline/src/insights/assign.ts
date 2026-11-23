/**
 * S3 归并：按品类，把还没归并的提法归到已有需求，或新建需求。
 * 需求 id 一旦生成就不变；每批归并完立刻写库，下一批会看到刚建的需求，所以多次运行结果一致、不重复。
 */
import { GENRES, needs } from "@app-radar/shared";
import { and, eq, isNull, sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { KINDS } from "./extract.ts";
import { isGeneric, OBJECT_RULE } from "./generic.ts";
import { ask, log, recordStep, type RunCtx } from "./runner.ts";

const KIND_CODES = Object.keys(KINDS) as [keyof typeof KINDS, ...(keyof typeof KINDS)[]];

const Out = z.object({
  assign: z.array(z.object({ s: z.coerce.number(), need: z.coerce.number().nullish(), new: z.string().nullish() })),
  new_needs: z.array(z.object({
    key: z.string(),
    title: z.string().min(2).transform((t) => t.trim().slice(0, 40)),
    description: z.string().catch("").transform((t) => t.trim().slice(0, 300)),
    kind: z.string().transform((k) => ((KIND_CODES as readonly string[]).includes(k) ? k : "other")),
    object: z.string().nullish().catch(""),
  })).catch([]),
});



const SYSTEM = `你在维护一个 App 品类的「用户需求目录」。目录里每个需求代表一件用户想要但没被满足的事，用来统计有多少人提到。

给你：现有需求目录（#编号 标题：说明），以及一批新的「提法」（s编号: 提法文字 [类型]）。
把每条提法归到一个需求：
- 意思相同或是同一件事的不同说法 → 归到已有需求（need 填编号）
- 目录里没有对应的 → 新建需求（在 new_needs 里定义，key 用 n1、n2…，assign 里 new 填这个 key）
- 太空泛、看不出要什么（如「功能太少」「希望改进」「不好用」）→ need 填 0，不要硬塞进某个需求

新建需求的要求：
- title：简体中文，20 字以内，写成需求本身，粒度要能跨 App 比较。例如「需要导出 CSV/Excel」「希望支持 Apple Watch」「免费版扫描页数限制太少」
- 粒度适中：同一件事的不同说法合并；不同的事分开（「导出」和「同步」是两件事）；不要按 App 拆开
- 严禁建「大杂烩」需求：不要建「缺少各类细节功能」「各种小问题」「其他建议」这类把不同诉求装在一起的需求
- description：一两句说明包含哪些情况
- kind：从 ${KIND_CODES.join(" / ")} 里选
- ${OBJECT_RULE}

每条提法都要出现在 assign 里，s 原样返回。只输出 JSON：
{"assign":[{"s":123,"need":45},{"s":124,"new":"n1"},{"s":125,"need":0}],"new_needs":[{"key":"n1","title":"...","description":"...","kind":"...","object":"导出 PDF"}]}`;

export const assignBench = { SYSTEM, Out };

export function assignPrompt(genreId: number, catalog: { id: number; title: string; description: string | null }[], batch: { id: number; text: string; kind: string }[]) {
  // 目录很大时只给标题，控制输入长度
  const showDesc = catalog.length <= 150;
  return [
    `品类：${GENRES[genreId]?.zh ?? genreId}`,
    `现有需求目录（${catalog.length} 个）：`,
    ...catalog.map((c) => `#${c.id} ${c.title}${showDesc && c.description ? `：${c.description}` : ""}`),
    "",
    `新提法（${batch.length} 条）：`,
    ...batch.map((b) => `s${b.id}: ${b.text} [${b.kind}]`),
  ].join("\n");
}

export async function runAssign(ctx: RunCtx) {
  const started = new Date();
  const p = ctx.cfg.insights.pipeline;
  const s = { batches: 0, assigned: 0, new_needs: 0, unassigned_left: 0, genres: [] as number[] };

  const genreRows = await ctx.db.execute<{ genre_id: number; n: number }>(sql`
    select genre_id, count(*)::int n from review_statements
    where need_id is null ${ctx.genres ? sql`and genre_id = any(${`{${ctx.genres.join(",")}}`}::int[])` : sql``}
    group by 1 order by 2 desc`);
  log("assign", `待归并：${genreRows.map((g) => `${GENRES[g.genre_id]?.zh ?? g.genre_id} ${g.n}`).join("、") || "无"}`);

  // 不同品类的需求目录互不相干，可以并行；同一品类内必须按批顺序进行（下一批要看到上一批新建的需求）
  let next = 0;
  const worker = async () => {
    while (!ctx.stopped && next < genreRows.length) {
      const g = genreRows[next++]!;
      await assignGenre(g);
    }
  };
  const assignGenre = async (g: { genre_id: number; n: number }) => {
    s.genres.push(g.genre_id);
    while (!ctx.stopped) {
      const batch = await ctx.db.execute<{ id: number; text: string; kind: string }>(sql`
        select id::float8 id, text, kind from review_statements where need_id is null and genre_id = ${g.genre_id}
        order by id limit ${p.assign_batch}`);
      if (batch.length === 0) break;
      const catalog = await ctx.db.select({ id: needs.id, title: needs.title, description: needs.description })
        .from(needs).where(and(eq(needs.genreId, g.genre_id), isNull(needs.mergedInto), eq(needs.retired, false))).orderBy(needs.id);
      const user = assignPrompt(g.genre_id, catalog, batch);

      const out = await ask(ctx, Out, SYSTEM, user);
      s.batches++;
      if (!out) break;

      const known = new Set(catalog.map((c) => c.id));
      const want = new Set(batch.map((b) => b.id));
      const now = new Date();
      const n = await ctx.db.transaction(async (tx) => {
        // 只建真的被引用到的新需求
        const used = new Set(out.assign.map((a) => a.new).filter(Boolean) as string[]);
        const keyToId = new Map<string, number>();
        for (const nn of out.new_needs.filter((x) => used.has(x.key))) {
          const [row] = await tx.insert(needs).values({
            genreId: g.genre_id, title: nn.title.trim(), description: nn.description.trim(), kind: nn.kind, object: nn.object?.trim() || null, generic: isGeneric(nn.kind, nn.object),
            provider: ctx.provider, model: ctx.model ?? "(默认)", createdAt: now, updatedAt: now,
          }).returning({ id: needs.id });
          keyToId.set(nn.key, row!.id);
        }
        const pairs = out.assign
          .filter((a) => want.has(a.s))
          // need = 0：太空泛，标记后不再参与归并和统计
          .map((a) => ({ s: a.s, need: a.need === 0 ? 0 : a.need != null && known.has(a.need) ? a.need : a.new ? keyToId.get(a.new) : undefined }))
          .filter((x): x is { s: number; need: number } => x.need !== undefined);
        if (pairs.length) {
          await tx.execute(sql`
            update review_statements st set need_id = v.need, assigned_at = now()
            from jsonb_to_recordset(${JSON.stringify(pairs)}::jsonb) v(s bigint, need bigint)
            where st.id = v.s and st.need_id is null`);
        }
        return { assigned: pairs.length, created: keyToId.size };
      });
      s.assigned += n.assigned;
      s.new_needs += n.created;
      log("assign", `${GENRES[g.genre_id]?.zh}：${n.assigned}/${batch.length} 条归并，新建 ${n.created} 个需求（目录 ${catalog.length + n.created}，调用 ${ctx.calls}）`);
      if (n.assigned === 0) { log("assign", "这一批没有归并成功，换下一个品类"); break; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(ctx.concurrency, genreRows.length) }, worker));
  const [left] = await ctx.db.execute<{ n: number }>(sql`select count(*)::int n from review_statements where need_id is null`);
  s.unassigned_left = left?.n ?? 0;
  await recordStep(ctx, "assign", started, s, ctx.stopped ? "partial" : "ok");
  return s;
}

const RelabelOut = z.object({
  needs: z.array(z.object({ id: z.coerce.number(), object: z.string().nullish().catch(""), catch_all: z.boolean().catch(false) })),
});

/**
 * 一次性整理已有目录：给每个需求标 generic；大杂烩需求撤销（retired），里面的提法清空 need_id 等待重新归并。
 * 只处理还没整理过的品类（用 job_runs 里的记录判断不了，所以由 --steps relabel 显式触发）。
 */
export async function runRelabel(ctx: RunCtx) {
  const started = new Date();
  const s = { genres: 0, generic: 0, retired: 0, statements_reset: 0 };
  const genres = await ctx.db.execute<{ genre_id: number }>(sql`
    select distinct genre_id from needs where not retired and merged_into is null
    ${ctx.genres ? sql`and genre_id = any(${`{${ctx.genres.join(",")}}`}::int[])` : sql``}`);
  for (const { genre_id } of genres) {
    if (ctx.stopped) break;
    const catalog = await ctx.db.select({ id: needs.id, title: needs.title, description: needs.description, kind: needs.kind })
      .from(needs).where(and(eq(needs.genreId, genre_id), isNull(needs.mergedInto), eq(needs.retired, false))).orderBy(needs.id);
    for (let i = 0; i < catalog.length && !ctx.stopped; i += 200) {
      const chunk = catalog.slice(i, i + 200);
      const out = await ask(ctx, RelabelOut, `你在整理一个 App 品类的用户需求目录。对每个需求给出：
1. ${OBJECT_RULE}
2. catch_all：是不是「大杂烩」——把多件不同的事装在一起（如「缺少各类细节功能」「各种小问题」「其他建议」）。
每个需求都要返回，id 原样返回。只输出 JSON：{"needs":[{"id":1,"object":"导出 PDF","catch_all":false}]}`,
        `品类：${GENRES[genre_id]?.zh}\n${chunk.map((c) => `#${c.id} ${c.title}${c.description ? `：${c.description}` : ""}`).join("\n")}`);
      if (!out) break;
      const ids = new Set(chunk.map((c) => c.id));
      const rows = out.needs.filter((n) => ids.has(n.id));
      await ctx.db.transaction(async (tx) => {
        for (const n of rows) {
          const kind = catalog.find((c) => c.id === n.id)?.kind ?? "other";
          await tx.update(needs).set({ object: n.object?.trim() || null, generic: isGeneric(kind, n.object), retired: n.catch_all, updatedAt: new Date() }).where(eq(needs.id, n.id));
          if (n.catch_all) {
            const r = await tx.execute(sql`update review_statements set need_id = null, assigned_at = null where need_id = ${n.id} returning 1`);
            s.statements_reset += (r as unknown as unknown[]).length;
          }
        }
      });
      s.generic += rows.filter((n) => isGeneric(catalog.find((c) => c.id === n.id)?.kind ?? "other", n.object) && !n.catch_all).length;
      s.retired += rows.filter((n) => n.catch_all).length;
    }
    s.genres++;
    log("relabel", `${GENRES[genre_id]?.zh}：${catalog.length} 个需求，通用抱怨 ${s.generic}，撤销大杂烩 ${s.retired}（累计）`);
  }
  // 通用抱怨和撤销的需求不再出卡片，删掉旧卡片
  await ctx.db.execute(sql`delete from opportunity_cards c using needs n where n.id = c.need_id and (n.generic or n.retired)`);
  await recordStep(ctx, "relabel", started, s, ctx.stopped ? "partial" : "ok");
  return s;
}

/**
 * S3 归并：按品类，把还没归并的提法归到已有需求，或新建需求。
 * 需求 id 一旦生成就不变；每批归并完立刻写库，下一批会看到刚建的需求，所以多次运行结果一致、不重复。
 */
import { GENRES, needs } from "@app-radar/shared";
import { and, eq, isNull, sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { KINDS } from "./extract.ts";
import { ask, log, recordStep, type RunCtx } from "./runner.ts";

const KIND_CODES = Object.keys(KINDS) as [keyof typeof KINDS, ...(keyof typeof KINDS)[]];

const Out = z.object({
  assign: z.array(z.object({ s: z.coerce.number(), need: z.coerce.number().nullish(), new: z.string().nullish() })),
  new_needs: z.array(z.object({
    key: z.string(),
    title: z.string().min(2).transform((t) => t.trim().slice(0, 40)),
    description: z.string().catch("").transform((t) => t.trim().slice(0, 300)),
    kind: z.string().transform((k) => ((KIND_CODES as readonly string[]).includes(k) ? k : "other")),
  })).catch([]),
});

const SYSTEM = `你在维护一个 App 品类的「用户需求目录」。目录里每个需求代表一件用户想要但没被满足的事，用来统计有多少人提到。

给你：现有需求目录（#编号 标题：说明），以及一批新的「提法」（s编号: 提法文字 [类型]）。
把每条提法归到一个需求：
- 意思相同或是同一件事的不同说法 → 归到已有需求（need 填编号）
- 目录里没有对应的 → 新建需求（在 new_needs 里定义，key 用 n1、n2…，assign 里 new 填这个 key）

新建需求的要求：
- title：简体中文，20 字以内，写成需求本身，粒度要能跨 App 比较。例如「希望有买断制、不要订阅」「需要导出 CSV/Excel」「免费额度太少」
- 粒度适中：不要把不同的事并成一个（「导出 PDF」和「导出 CSV」可以并成「导出格式不够」；但「导出」和「同步」是两件事），也不要按 App 拆开
- description：一两句说明包含哪些情况
- kind：从 ${KIND_CODES.join(" / ")} 里选

每条提法都要出现在 assign 里，s 原样返回。只输出 JSON：
{"assign":[{"s":123,"need":45},{"s":124,"new":"n1"}],"new_needs":[{"key":"n1","title":"...","description":"...","kind":"..."}]}`;

export async function runAssign(ctx: RunCtx) {
  const started = new Date();
  const p = ctx.cfg.insights.pipeline;
  const s = { batches: 0, assigned: 0, new_needs: 0, unassigned_left: 0, genres: [] as number[] };

  const genreRows = await ctx.db.execute<{ genre_id: number; n: number }>(sql`
    select genre_id, count(*)::int n from review_statements
    where need_id is null ${ctx.genres ? sql`and genre_id = any(${`{${ctx.genres.join(",")}}`}::int[])` : sql``}
    group by 1 order by 2 desc`);
  log("assign", `待归并：${genreRows.map((g) => `${GENRES[g.genre_id]?.zh ?? g.genre_id} ${g.n}`).join("、") || "无"}`);

  for (const g of genreRows) {
    if (ctx.stopped) break;
    s.genres.push(g.genre_id);
    while (!ctx.stopped) {
      const batch = await ctx.db.execute<{ id: number; text: string; kind: string }>(sql`
        select id::float8 id, text, kind from review_statements where need_id is null and genre_id = ${g.genre_id}
        order by id limit ${p.assign_batch}`);
      if (batch.length === 0) break;
      const catalog = await ctx.db.select({ id: needs.id, title: needs.title, description: needs.description })
        .from(needs).where(and(eq(needs.genreId, g.genre_id), isNull(needs.mergedInto))).orderBy(needs.id);
      // 目录很大时只给标题，控制输入长度
      const showDesc = catalog.length <= 150;
      const user = [
        `品类：${GENRES[g.genre_id]?.zh ?? g.genre_id}`,
        `现有需求目录（${catalog.length} 个）：`,
        ...catalog.map((c) => `#${c.id} ${c.title}${showDesc && c.description ? `：${c.description}` : ""}`),
        "",
        `新提法（${batch.length} 条）：`,
        ...batch.map((b) => `s${b.id}: ${b.text} [${b.kind}]`),
      ].join("\n");

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
            genreId: g.genre_id, title: nn.title.trim(), description: nn.description.trim(), kind: nn.kind,
            provider: ctx.provider, model: ctx.model ?? "(默认)", createdAt: now, updatedAt: now,
          }).returning({ id: needs.id });
          keyToId.set(nn.key, row!.id);
        }
        const pairs = out.assign
          .filter((a) => want.has(a.s))
          .map((a) => ({ s: a.s, need: a.need != null && known.has(a.need) ? a.need : a.new ? keyToId.get(a.new) : undefined }))
          .filter((x): x is { s: number; need: number } => x.need !== undefined);
        if (pairs.length) {
          await tx.execute(sql`
            update review_statements st set need_id = v.need, assigned_at = ${now}
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
  }
  const [left] = await ctx.db.execute<{ n: number }>(sql`select count(*)::int n from review_statements where need_id is null`);
  s.unassigned_left = left?.n ?? 0;
  await recordStep(ctx, "assign", started, s, ctx.stopped ? "partial" : "ok");
  return s;
}

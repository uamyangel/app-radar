/**
 * S2.5 细分场景：给有提法的 App 标上场景（品类下按「用户要完成的事」再分一层，同一场景里的 App 互为替代品）。
 * 需求按场景归并：用户的吐槽离开具体场景就没有意义（「希望保持简单」在经期追踪和冥想里是两回事）。
 * 和归并一样：场景 id 一旦生成不变；每批写完立刻入库，下一批能看到刚建的场景。
 */
import { appScenes, GENRES, scenes } from "@app-radar/shared";
import { eq, sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { ask, log, recordStep, type RunCtx } from "./runner.ts";

const BATCH = 40;

const Out = z.object({
  apps: z.array(z.object({ id: z.coerce.number(), scene: z.number().int().nullable().catch(null) })),
  new_scenes: z.array(z.object({
    key: z.coerce.number().int().negative(),
    name: z.string().min(2).transform((t) => t.trim().slice(0, 20)),
    description: z.string().catch("").transform((t) => t.trim().slice(0, 200)),
  })).catch([]),
});

const SYSTEM = `你在给 App Store 某个品类里的 App 划分「细分场景」。场景 = 用户用这个 App 要完成的一件事；同一场景里的 App 互为替代品（用户可以从一个换到另一个）。

给你：这个品类现有的场景（#编号 名称：说明），以及一批 App（a编号: 名称 / 开发者 / 简介）。
给每个 App 选一个场景：
- 现有场景里有对应的 → scene 填编号
- 没有对应的 → 新建（在 new_scenes 里定义，key 用负数 -1、-2…，scene 填这个负数）

场景粒度：
- 好的例子：「经期追踪」「卡路里与饮食记录」「力量训练记录」「冥想与助眠」「血压记录」「医保与保险会员服务」「笔记」「文档扫描」「翻译」「VPN」「健身房会员与课程预约」
- 太粗（不要）：「健康」「效率工具」「生活服务」——里面的 App 互相替代不了
- 太细（不要）：按品牌、按单个功能、按付费方式拆（「Flo 用户」「经期提醒」「免费记账」）
- 一个 App 有多个用途时，按它最主要的用途选一个
- 某个公司、学校、医院、银行、门店给自己的客户或会员用的 App（会员卡、预约、账户管理），按服务类型归一个场景，例如「健身房会员与课程预约」「医保与保险会员服务」

name：简体中文，12 字以内。description：一句话说明包括哪些 App。
每个 App 都要出现在 apps 里，id 原样返回（数字，不带 a）。只输出 JSON：
{"apps":[{"id":123,"scene":5},{"id":456,"scene":-1}],"new_scenes":[{"key":-1,"name":"经期追踪","description":"记录经期、预测排卵和周期的 App"}]}`;

export const scenesBench = { SYSTEM, Out };

type AppRow = { app_id: number; genre_id: number; name: string; developer: string | null; about: string | null };

/** 待标场景的 App：有提法、还没有场景 */
export const unlabeledApps = sql`
  select distinct s.app_id from review_statements s
  where not exists (select 1 from app_scenes x where x.app_id = s.app_id)`;

export async function runScenes(ctx: RunCtx) {
  const started = new Date();
  const s = { batches: 0, labeled: 0, new_scenes: 0, left: 0 };
  // 每个 App 取一个国家的名称和简介（优先美国，英文简介模型最熟）；品类用提法里记录的主品类
  const rows = await ctx.db.execute<AppRow>(sql`
    with todo as (
      select s.app_id, min(s.genre_id) genre_id from review_statements s
      where not exists (select 1 from app_scenes x where x.app_id = s.app_id)
      ${ctx.genres ? sql`and s.genre_id = any(${`{${ctx.genres.join(",")}}`}::int[])` : sql``}
      group by 1)
    select distinct on (t.app_id) t.app_id::float8 app_id, t.genre_id, a.name, a.developer,
      left(regexp_replace(btrim(a.description), '[[:space:]]+', ' ', 'g'), 220) about
    from todo t join apps a on a.app_id = t.app_id
    order by t.app_id, (a.country = 'us') desc`);
  const byGenre = new Map<number, AppRow[]>();
  for (const r of rows) {
    if (!byGenre.has(r.genre_id)) byGenre.set(r.genre_id, []);
    byGenre.get(r.genre_id)!.push(r);
  }
  log("scenes", `待标场景的 App：${[...byGenre].map(([g, xs]) => `${GENRES[g]?.zh ?? g} ${xs.length}`).join("、") || "无"}`);

  // 不同品类互不相干，可以并行；同一品类内按批顺序进行（下一批要看到上一批新建的场景）
  const genres = [...byGenre.keys()];
  let next = 0;
  const worker = async () => {
    while (!ctx.stopped && next < genres.length) {
      const g = genres[next++]!;
      await labelGenre(g, byGenre.get(g)!);
    }
  };
  const labelGenre = async (genreId: number, apps: AppRow[]) => {
    for (let i = 0; i < apps.length && !ctx.stopped; i += BATCH) {
      const batch = apps.slice(i, i + BATCH);
      const catalog = await ctx.db.select({ id: scenes.id, name: scenes.name, description: scenes.description })
        .from(scenes).where(eq(scenes.genreId, genreId)).orderBy(scenes.id);
      const user = [
        `品类：${GENRES[genreId]?.zh ?? genreId}`,
        `现有场景（${catalog.length} 个）：`,
        ...catalog.map((c) => `#${c.id} ${c.name}${c.description ? `：${c.description}` : ""}`),
        "",
        `App（${batch.length} 个）：`,
        ...batch.map((a) => `a${a.app_id}: ${a.name} / ${a.developer ?? ""} / ${a.about ?? ""}`),
      ].join("\n");
      const out = await ask(ctx, Out, SYSTEM, user);
      s.batches++;
      if (!out) return;

      const known = new Set(catalog.map((c) => c.id));
      const want = new Set(batch.map((a) => a.app_id));
      const now = new Date();
      const n = await ctx.db.transaction(async (tx) => {
        const used = new Set(out.apps.map((a) => a.scene).filter((x): x is number => x !== null && x < 0));
        const keyToId = new Map<number, number>();
        for (const ns of out.new_scenes.filter((x) => used.has(x.key))) {
          const [row] = await tx.insert(scenes).values({
            genreId, name: ns.name, description: ns.description || null, provider: ctx.provider, model: ctx.model ?? "(默认)", createdAt: now,
          }).returning({ id: scenes.id });
          keyToId.set(ns.key, row!.id);
        }
        const pairs = out.apps
          .filter((a) => want.has(a.id) && a.scene !== null)
          .map((a) => ({ appId: a.id, sceneId: a.scene! > 0 ? (known.has(a.scene!) ? a.scene! : undefined) : keyToId.get(a.scene!) }))
          .filter((x): x is { appId: number; sceneId: number } => x.sceneId !== undefined);
        if (pairs.length) {
          await tx.insert(appScenes).values(pairs.map((p) => ({ ...p, provider: ctx.provider, model: ctx.model ?? "(默认)", labeledAt: now })))
            .onConflictDoNothing();
        }
        return { labeled: pairs.length, created: keyToId.size };
      });
      s.labeled += n.labeled;
      s.new_scenes += n.created;
      log("scenes", `${GENRES[genreId]?.zh}：${n.labeled}/${batch.length} 个 App 标好，新建 ${n.created} 个场景（共 ${catalog.length + n.created}，调用 ${ctx.calls}）`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(ctx.concurrency, genres.length) }, worker));
  const [left] = await ctx.db.execute<{ n: number }>(sql`select count(*)::int n from (${unlabeledApps}) x`);
  s.left = left?.n ?? 0;
  await recordStep(ctx, "scenes", started, s, ctx.stopped ? "partial" : "ok");
  return s;
}

/**
 * 一次性切换到按场景归并（--steps rebuild）：按品类建的旧需求全部撤销，提法清空归并结果，等按场景重新归并。
 * 旧需求的指标和卡片一起删掉；需求 id 不复用，旧链接打开会显示「没有数据」。
 */
export async function runRebuild(ctx: RunCtx) {
  const started = new Date();
  const s = await ctx.db.transaction(async (tx) => {
    const retired = await tx.execute(sql`update needs set retired = true, updated_at = now() where scene_id is null and not retired returning id`);
    const reset = await tx.execute(sql`
      update review_statements st set need_id = null, assigned_at = null
      where exists (select 1 from needs n where n.id = st.need_id and n.scene_id is null)
      returning 1`);
    await tx.execute(sql`delete from need_metrics m using needs n where n.id = m.need_id and n.scene_id is null`);
    await tx.execute(sql`delete from opportunity_cards c using needs n where n.id = c.need_id and n.scene_id is null`);
    return { retired: (retired as unknown as unknown[]).length, statements_reset: (reset as unknown as unknown[]).length };
  });
  log("rebuild", `撤销旧需求 ${s.retired} 个，${s.statements_reset} 条提法等待按场景重新归并`);
  await recordStep(ctx, "rebuild", started, s, "ok");
  return s;
}

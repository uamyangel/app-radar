/**
 * S1 挑选 + S2 提取（docs/insights-design.md 第 5 节）
 * 挑选（程序）：白名单品类、开发者为 major / normal 的 App，近 window_days 天的 1–3 星评论，
 *              以及命中诉求词的 4–5 星评论；已提取过的跳过。
 * 提取（AI）：每条评论 → 0–3 条提法（简体中文短句 + 类型 + 流失/付费意愿 + 提到的替代品）。
 */
import { GENRES, reviewExtractions, reviewStatements } from "@app-radar/shared";
import { KINDS } from "@app-radar/shared/needs";
export { KINDS };
import { sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { pgIntArray, pgTextArray } from "../stages/scope.ts";
import { ask, log, recordStep, type RunCtx } from "./runner.ts";

export const EXTRACT_VERSION = "extract-v1";
const KIND_CODES = Object.keys(KINDS) as (keyof typeof KINDS)[];

// 关键字段严格（id、relevant），次要字段宽进再修正：多于 3 条只留前 3 条、过长截断、未知类型归 other
const Statement = z.object({
  text: z.string().min(2).transform((t) => t.trim().slice(0, 60)),
  kind: z.string().transform((k) => ((KIND_CODES as readonly string[]).includes(k) ? k : "other") as keyof typeof KINDS),
  churn: z.boolean().catch(false),
  pay: z.boolean().catch(false),
  competitor: z.string().nullish().catch(null).transform((c) => (c ? c.trim().slice(0, 60) : null)),
});
const Out = z.object({
  items: z.array(z.object({
    id: z.string(),
    relevant: z.boolean(),
    statements: z.array(Statement).catch([]).transform((xs) => xs.slice(0, 3)),
  })),
});

const SYSTEM = `你是做产品机会研究的分析师。从 App Store 用户评论里提取「提法」：用户想要但没得到满足的具体东西。

每条评论输出 0–3 条提法：
- text：简体中文短句，30 字以内，写成「需求」本身，要能跨 App 比较。不写 App 名字。
  好的例子：「希望支持导出 CSV」「订阅太贵，想要买断版」「希望有 iPad 横屏版」「免费版每天只能用 3 次太少」「同步后数据丢失」
  坏的例子：「这个 App 很垃圾」「用户不满意」「XX 不好用」（太空泛，看不出要什么）
- kind：从下面选一个
${Object.entries(KINDS).map(([k, v]) => `  ${k}：${v}`).join("\n")}
- churn：评论表示已经卸载、要换掉、在找替代品时为 true
- pay：评论表示愿意付费、愿意买断、愿意为某功能付钱时为 true
- competitor：评论提到用来对比或替代的其他产品名时填写，否则 null

规则：
1. 只提取有具体内容的诉求。纯情绪（「垃圾」「很好」）、纯好评、只有表情的评论，statements 为空数组。
2. 内容和这个 App 明显无关（发错地方、广告、刷评）时 relevant 为 false。
3. 评论可能是任何语言，text 一律用简体中文。
4. 每条输入都要有一条输出，id 原样返回。只输出 JSON：{"items":[{"id":"...","relevant":true,"statements":[...]}]}`;

type ExtractStats = { batches: number; reviews: number; statements: number; empty: number; irrelevant: number; missing: number; skipped: number; pending_before: number };
type Row = { review_id: string; app_id: number; country: string; genre: number; app_name: string; rating: number; title: string | null; content: string; reviewed_at: string };

/** 待提取的评论：白名单品类、开发者 major / normal、近 window_days 天的 1–3 星或带诉求词的评论，还没提取过（定时运行判断有没有待办也用它） */
export function extractFilters(cfg: RunCtx["cfg"], countries: string[], genres: number[] | null) {
  const p = cfg.insights.pipeline;
  return sql`
    from reviews r
    join apps a on a.app_id = r.app_id and a.country = r.country
    left join developers d on d.developer_id = a.developer_id
    left join review_extractions e on e.review_id = r.review_id
    where e.review_id is null
      and r.reviewed_at > now() - make_interval(days => ${p.window_days})
      and r.country = any(${pgTextArray(countries)}::text[])
      and a.primary_genre_id = any(${pgIntArray(genres ?? cfg.insights.include_genres)}::int[])
      and coalesce(d.type, 'normal') in ('major', 'normal')
      and (r.rating <= 3 or r.content ~* ${p.request_pattern} or coalesce(r.title, '') ~* ${p.request_pattern})`;
}

export async function runExtract(ctx: RunCtx, opts: { redoSince: string | null }) {
  const started = new Date();
  const p = ctx.cfg.insights.pipeline;
  const s: ExtractStats = { batches: 0, reviews: 0, statements: 0, empty: 0, irrelevant: 0, missing: 0, skipped: 0, pending_before: 0 };
  const missedOnce = new Set<string>(); // 模型漏掉一次的评论；同一次运行里再漏就标 skipped，避免反复取到同一批

  if (opts.redoSince) {
    // 显式重做：删掉这段时间内的提取结果和提法（它们的归并也随之作废）
    const del = await ctx.db.execute(sql`
      with d as (delete from review_extractions e using reviews r
        where e.review_id = r.review_id and r.reviewed_at >= ${opts.redoSince}::date and e.country = any(${pgTextArray(ctx.countries)}::text[]) returning e.review_id)
      delete from review_statements s using d where s.review_id = d.review_id`);
    log("extract", `已清除 ${opts.redoSince} 之后的提取结果，重新提取（${(del as unknown as unknown[]).length ?? 0}）`);
  }

  const filters = extractFilters(ctx.cfg, ctx.countries, ctx.genres);
  const [cnt] = await ctx.db.execute<{ n: number }>(sql`select count(*)::int n ${filters}`);
  s.pending_before = cnt?.n ?? 0;
  log("extract", `待提取 ${s.pending_before} 条评论`);

  // 每轮取 concurrency 批互不重叠的评论，并行调用；按 App 聚在一起（模型更容易理解上下文），新的优先
  while (!ctx.stopped) {
    const rows = await ctx.db.execute<Row>(sql`
      select r.review_id, r.app_id::float8 app_id, r.country, a.primary_genre_id genre, a.name app_name, r.rating::int rating,
             r.title, left(r.content, 1000) content, to_json(r.reviewed_at)#>>'{}' reviewed_at
      ${filters}
      order by r.app_id, r.reviewed_at desc
      limit ${p.extract_batch * ctx.concurrency}`);
    if (rows.length === 0) break;
    const batches: Row[][] = [];
    for (let i = 0; i < rows.length; i += p.extract_batch) batches.push(rows.slice(i, i + p.extract_batch));
    const results = await Promise.all(batches.map((b) => processBatch(ctx, b, s, missedOnce)));
    if (results.every((ok) => !ok)) break; // 这一轮全部失败：停下，未处理的下次再来
  }

  await recordStep(ctx, "extract", started, s, ctx.stopped ? "partial" : "ok");
  return s;
}

/** 处理一批：调用模型、校验、在一个事务里写提法和「已提取」标记。返回是否有进展 */
async function processBatch(ctx: RunCtx, rows: Row[], s: ExtractStats, missedOnce: Set<string>): Promise<boolean> {
  const payload = rows.map((r) => ({
    id: r.review_id, app: r.app_name, category: GENRES[r.genre]?.zh ?? String(r.genre), stars: r.rating,
    title: r.title ?? "", text: r.content,
  }));
  const out = await ask(ctx, Out, SYSTEM, JSON.stringify(payload));
  s.batches++;
  if (!out) return false;

  const byId = new Map(rows.map((r) => [r.review_id, r]));
  const done = out.items.filter((x) => byId.has(x.id));
  const returned = new Set(done.map((x) => x.id));
  const missed = rows.filter((r) => !returned.has(r.review_id));
  s.missing += missed.length;
  const now = new Date();
  const skip = missed.filter((r) => missedOnce.has(r.review_id));
  for (const r of missed) missedOnce.add(r.review_id);
  if (skip.length) {
    await ctx.db.insert(reviewExtractions).values(skip.map((r) => ({
      reviewId: r.review_id, appId: r.app_id, country: r.country, genreId: r.genre, status: "skipped", statementsN: 0,
      promptVersion: EXTRACT_VERSION, provider: ctx.provider, model: ctx.model ?? "(默认)", extractedAt: now,
    }))).onConflictDoNothing();
    s.skipped += skip.length;
  }
  if (done.length === 0) { log("extract", "这一批没有任何有效输出"); return skip.length > 0; }

  const stRows = done.flatMap((x) => {
    const r = byId.get(x.id)!;
    return x.relevant ? x.statements.map((st) => ({
      reviewId: r.review_id, appId: r.app_id, country: r.country, genreId: r.genre, rating: r.rating,
      reviewedAt: new Date(r.reviewed_at), text: st.text, kind: st.kind, churn: st.churn, pay: st.pay,
      competitor: st.competitor, createdAt: now,
    })) : [];
  });
  const exRows = done.map((x) => {
    const r = byId.get(x.id)!;
    const status = !x.relevant ? "irrelevant" : x.statements.length ? "ok" : "empty";
    if (status === "empty") s.empty++;
    if (status === "irrelevant") s.irrelevant++;
    return {
      reviewId: r.review_id, appId: r.app_id, country: r.country, genreId: r.genre, status, statementsN: x.relevant ? x.statements.length : 0,
      promptVersion: EXTRACT_VERSION, provider: ctx.provider, model: ctx.model ?? "(默认)", extractedAt: now,
    };
  });
  // 同一个事务里写提法和「已提取」标记，中断也不会出现一半；已被别的批次标记的评论跳过，不会重复写提法
  const wrote = await ctx.db.transaction(async (tx) => {
    const marked = await tx.insert(reviewExtractions).values(exRows).onConflictDoNothing().returning({ id: reviewExtractions.reviewId });
    const fresh = new Set(marked.map((m) => m.id));
    const toWrite = stRows.filter((x) => fresh.has(x.reviewId));
    if (toWrite.length) await tx.insert(reviewStatements).values(toWrite);
    return { reviews: fresh.size, statements: toWrite.length };
  });
  s.reviews += wrote.reviews;
  s.statements += wrote.statements;
  log("extract", `${wrote.reviews} 条评论 → ${wrote.statements} 条提法（累计 ${s.reviews}/${s.pending_before}，调用 ${ctx.calls}）`);
  return true;
}

/** 供模型基准测试使用 */
export const benchExports = { SYSTEM, Out };

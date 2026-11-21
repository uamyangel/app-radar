import { appSummaries, GAMES_GENRE_ID, GENRES, TOPICS, type Country, type Topic } from "@app-radar/shared";
import { sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { Job, log, type Ctx } from "../context.ts";
import { Llm, pool, requireApiKey } from "../llm.ts";
import { pgIntArray, rankedScope, weekStartOf } from "./scope.ts";

/** SPEC 7.2 的输出格式（前端依赖这些字段，只能加不能删改） */
export const SummarySchema = z.object({
  one_liner: z.string(),
  positioning: z.string(),
  loved: z.array(z.string()),
  complaints: z.array(z.object({ theme: z.string(), share: z.string(), example_review_ids: z.array(z.string()) })),
  rating_trend: z.string(),
  notable_changes: z.string(),
  opportunity_hint: z.string(),
});

const SYSTEM = `你是做产品机会研究的分析师。根据给定的 App 数据写一份周度摘要，帮助判断用户需求和产品机会。

只输出 JSON，字段如下（全部用简体中文）：
{
  "one_liner": "一句话说明这个 App 是什么、给谁用（30 字以内）",
  "positioning": "定位与核心功能（2–3 句）",
  "loved": ["用户喜欢的点，3–5 条，每条一句"],
  "complaints": [{"theme": "抱怨主题", "share": "大致占比或频次，例如「约 30% 的低分评论」", "example_review_ids": ["1–3 个最能说明问题的评论 id"]}],
  "rating_trend": "评分变化及可能原因",
  "notable_changes": "近期版本或排名的显著变化，没有就写「无明显变化」",
  "opportunity_hint": "从用户抱怨里看出的、现有产品没满足的需求；看不出来就写空字符串"
}

要求：
1. 只依据提供的数据，不编造。占比用 topic_stats 里已经算好的数字，不要自己估算。
   解释评分或排名变化的原因时必须有数据依据（版本更新时间、评论集中提到的问题）；没有依据就只陈述事实，不要猜测外部原因。
2. complaints 按严重程度排序，最多 5 条，主题要具体（例如「免费额度太少」而不是「收费问题」）。
3. example_review_ids 必须是 reviews 里出现过的 id。
4. 评论可能是任何语言，总结一律用简体中文。`;

type Candidate = { app_id: number; best_rank: number; n30: number };

/**
 * App 周度摘要：评论范围内、近 30 天评论够多、本周还没生成、上次生成后有新评论的 App。
 * 按排名从高到低处理，预算用完就停，剩下的之后几天继续（同一个 week_start）。
 */
export async function runSummaries(ctx: Ctx) {
  const job = await new Job(ctx, "summaries").start();
  if (!ctx.db) { job.error("摘要需要读库，dry-run 下跳过（测试请对本地副本库运行并加 --limit）"); return job.finish(); }
  const llm = new Llm(ctx, job, requireApiKey());
  const week = weekStartOf(ctx.date);
  const s = { week_start: week, candidates: 0, generated: 0, failed: 0, stopped_by_budget: false };
  job.stats = { ...s, llm: llm.stats };

  const scope = await rankedScope(ctx);
  for (const cc of ctx.countries) {
    const ranked = scope.get(cc) ?? [];
    if (ranked.length === 0) continue;
    let cands = await candidates(ctx, cc, ranked, week);
    if (ctx.limit !== null) cands = cands.slice(0, ctx.limit);
    s.candidates += cands.length;
    log("summaries", `${cc}：${cands.length} 个 App 需要生成（week_start=${week}）`);

    const r = await pool(cands, ctx.cfg.llm.concurrency, async (c) => {
      if (Date.now() > ctx.deadline) return;
      const input = await buildInput(ctx, cc, c.app_id);
      if (!input) return;
      const out = await llm.json(SummarySchema, [
        { role: "system", content: SYSTEM },
        { role: "user", content: JSON.stringify(input.payload) },
      ], 2000);
      if (!out) { s.failed++; return; }
      // 示例评论 id 只保留输入里真实存在的
      for (const x of out.complaints) x.example_review_ids = x.example_review_ids.filter((id) => input.reviewIds.has(id)).slice(0, 3);
      await ctx.db!.insert(appSummaries)
        .values({ appId: c.app_id, country: cc, weekStart: week, summary: out, model: ctx.cfg.llm.model, createdAt: new Date() })
        .onConflictDoUpdate({
          target: [appSummaries.appId, appSummaries.country, appSummaries.weekStart],
          set: { summary: out, model: ctx.cfg.llm.model, createdAt: new Date() },
        });
      s.generated++;
      if (s.generated % 50 === 0) log("summaries", `已生成 ${s.generated}，费用 $${llm.stats.cost_usd.toFixed(3)}`);
    });
    if (r.stoppedByBudget) { s.stopped_by_budget = true; break; }
  }
  job.stats = { ...s, llm: llm.stats };
  if (s.stopped_by_budget) log("summaries", "⚠️ 已达每日预算，剩下的 App 明天继续");
  return job.finish();
}

async function candidates(ctx: Ctx, cc: Country, ranked: [number, number][], week: string): Promise<Candidate[]> {
  const ids = ranked.map(([id]) => id);
  const rank = new Map(ranked);
  const rows = await ctx.db!.execute<{ app_id: number; n30: number }>(sql`
    with s as (select unnest(${pgIntArray(ids)}::bigint[]) app_id)
    select s.app_id::float8 app_id, r.n30
    from s
    join apps a on a.app_id = s.app_id and a.country = ${cc} and coalesce(a.primary_genre_id, 0) <> ${GAMES_GENRE_ID}
    join lateral (
      select count(*)::int n30, max(fetched_at) last_fetch from reviews
      where app_id = s.app_id and country = ${cc} and reviewed_at > now() - interval '30 days'
    ) r on true
    left join lateral (
      select week_start, created_at from app_summaries where app_id = s.app_id and country = ${cc} order by week_start desc limit 1
    ) last on true
    where r.n30 >= ${ctx.cfg.llm.summary_min_reviews}
      and (last.week_start is null or (last.week_start < ${week}::date and r.last_fetch > last.created_at))`);
  return rows.map((r) => ({ ...r, best_rank: rank.get(r.app_id) ?? 999 })).sort((a, b) => a.best_rank - b.best_rank);
}

/** 组装给模型的输入：数字由程序算好，模型只负责归纳和表述 */
async function buildInput(ctx: Ctx, cc: Country, appId: number) {
  const db = ctx.db!;
  const [app] = await db.execute<Record<string, unknown>>(sql`
    select name, developer, primary_genre_id, price::float8, currency, rating_avg::float8 rating, rating_count, version,
           version_date::date::text version_date, left(release_notes, 500) release_notes, left(description, 600) description
    from apps where app_id = ${appId} and country = ${cc}`);
  if (!app) return null;

  // 低分评论优先：最多 60 条 1–3 星 + 20 条 4–5 星，都取最近的
  const reviews = await db.execute<{ id: string; r: number; d: string; v: string | null; t: string; c: string; g: string | null; topics: string[] | null }>(sql`
    (select review_id id, rating::int r, reviewed_at::date::text d, app_version v, coalesce(title, '') t, left(content, 300) c, gist g, topics
     from reviews where app_id = ${appId} and country = ${cc} and reviewed_at > now() - interval '30 days' and rating <= 3
     order by reviewed_at desc limit 60)
    union all
    (select review_id, rating::int, reviewed_at::date::text, app_version, coalesce(title, ''), left(content, 300), gist, topics
     from reviews where app_id = ${appId} and country = ${cc} and reviewed_at > now() - interval '30 days' and rating >= 4
     order by reviewed_at desc limit 20)`);

  const topicRows = await db.execute<{ topic: string; n: number; avg_rating: number }>(sql`
    select t topic, count(*)::int n, round(avg(rating), 2)::float8 avg_rating
    from reviews, unnest(topics) t
    where app_id = ${appId} and country = ${cc} and reviewed_at > now() - interval '30 days'
    group by 1 order by 2 desc`);
  const [tot] = await db.execute<{ n: number; low: number }>(sql`
    select count(*)::int n, count(*) filter (where rating <= 3)::int low from reviews
    where app_id = ${appId} and country = ${cc} and reviewed_at > now() - interval '30 days' and classified_at is not null`);

  const rating = await db.execute<{ d: string; avg: number; n: number }>(sql`
    select snapshot_date::text d, rating_avg::float8 avg, rating_count n from app_rating_daily
    where app_id = ${appId} and country = ${cc} and snapshot_date > now()::date - 30 order by 1`);
  const ranks = await db.execute<{ genre_id: number; chart_type: string; d: string; rank: number }>(sql`
    select genre_id, chart_type, snapshot_date::text d, array_position(app_ids, ${appId}::bigint) rank
    from chart_snapshots where country = ${cc} and snapshot_date > now()::date - 30 and ${appId}::bigint = any(app_ids)
    order by snapshot_date`);
  const byChart = new Map<string, { d: string; rank: number }[]>();
  for (const r of ranks) {
    const k = `${GENRES[r.genre_id]?.zh ?? r.genre_id}·${r.chart_type}`;
    if (!byChart.has(k)) byChart.set(k, []);
    byChart.get(k)!.push({ d: r.d, rank: r.rank });
  }

  const classified = tot?.n ?? 0;
  const payload = {
    app: { ...app, genre: GENRES[Number(app.primary_genre_id)]?.zh ?? null, country: cc },
    rating_trend: rating.length ? { first: rating[0], last: rating.at(-1), days: rating.length } : null,
    ranks: [...byChart.entries()].map(([chart, pts]) => ({
      chart, latest: pts.at(-1), earliest: pts[0], best: Math.min(...pts.map((p) => p.rank)), worst: Math.max(...pts.map((p) => p.rank)), days_on_chart: pts.length,
    })),
    topic_stats: {
      reviews_classified_30d: classified,
      low_rating_reviews_30d: tot?.low ?? 0,
      topics: topicRows.map((t) => ({ topic: TOPICS[t.topic as Topic]?.label ?? t.topic, n: t.n, share_of_reviews: classified ? `${Math.round((t.n / classified) * 100)}%` : null, avg_rating: t.avg_rating })),
    },
    reviews: reviews.map((r) => ({ id: r.id, r: r.r, d: r.d, v: r.v, t: r.t, c: r.c, g: r.g, topics: r.topics })),
  };
  return { payload, reviewIds: new Set(reviews.map((r) => r.id)) };
}

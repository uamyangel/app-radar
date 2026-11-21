import { categoryBriefs, CHART_TYPES, GENRES, TOPICS, type ChartType, type Country, type Topic } from "@app-radar/shared";
import { and, eq, sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { Job, log, type Ctx } from "../context.ts";
import { Llm, pool, requireApiKey } from "../llm.ts";
import { pgIntArray, weekStartOf } from "./scope.ts";

/** SPEC 7.3 的输出格式（前端依赖这些字段，只能加不能删改） */
export const BriefSchema = z.object({
  headline: z.string(),
  new_entries: z.array(z.object({ app_id: z.coerce.number(), note: z.string() })),
  movers: z.array(z.object({ app_id: z.coerce.number(), direction: z.enum(["up", "down"]), note: z.string() })),
  pain_points: z.array(z.object({ theme: z.string(), description: z.string(), frequency: z.enum(["高", "中", "低"]), example_review_ids: z.array(z.string()) })),
  opportunities: z.array(z.object({ signal: z.string(), reasoning: z.string() })),
});

const CHART_ZH: Record<ChartType, string> = { free: "免费榜", paid: "付费榜", grossing: "畅销榜" };

const SYSTEM = `你是做产品机会研究的分析师。根据程序已经算好的榜单变化和用户评论，写一份 App Store 某品类的周度简报，帮助发现需求信号和产品机会。

只输出 JSON（全部用简体中文）：
{
  "headline": "一句话概括本周该品类最值得注意的变化",
  "new_entries": [{"app_id": 0, "note": "为什么值得关注（结合它是什么、排名、评分）"}],
  "movers": [{"app_id": 0, "direction": "up 或 down", "note": "变化幅度、它是什么，以及数据里能看到的相关信号"}],
  "pain_points": [{"theme": "痛点主题", "description": "具体描述", "frequency": "高|中|低", "example_review_ids": ["评论 id"]}],
  "opportunities": [{"signal": "观察到的信号", "reasoning": "为什么可能是机会"}]
}

要求：
1. 只依据提供的数据，不编造；数字直接引用输入里算好的，不要自己算。
   解释变化原因时必须有数据依据（例如 version_date 显示最近刚更新、评分明显变化、评论集中抱怨某问题）；没有依据就只陈述事实，不要猜测季节、节日、市场需求等外部原因。
2. new_entries、movers 只从输入对应的列表里挑最值得关注的，各最多 5 个；app_id 必须来自输入。
3. pain_points 3–6 条，参考 topic_stats 判断频率高低，主题要具体；example_review_ids 必须来自 low_rating_samples。
4. opportunities 2–4 条，重点看「低评分高排名」（需求强、产品弱）和反复出现的抱怨。
5. 没有历史数据时（history_days 为 0），new_entries 和 movers 返回空数组，并在 headline 里不提排名变化。`;

/** 品类周度简报：每个国家 × 品类每周一份；本周已经生成的跳过 */
export async function runBriefs(ctx: Ctx) {
  const job = await new Job(ctx, "briefs").start();
  if (!ctx.db) { job.error("简报需要读库，dry-run 下跳过"); return job.finish(); }
  const llm = new Llm(ctx, job, requireApiKey());
  const week = weekStartOf(ctx.date);
  const s = { week_start: week, todo: 0, generated: 0, failed: 0, stopped_by_budget: false };
  job.stats = { ...s, llm: llm.stats };

  const todo: { cc: Country; genre: number }[] = [];
  for (const cc of ctx.countries) {
    for (const genre of ctx.genres) {
      const [exists] = await ctx.db.select({ w: categoryBriefs.weekStart }).from(categoryBriefs)
        .where(and(eq(categoryBriefs.country, cc), eq(categoryBriefs.genreId, genre), eq(categoryBriefs.weekStart, week)));
      if (!exists) todo.push({ cc, genre });
    }
  }
  const list = ctx.limit !== null ? todo.slice(0, ctx.limit) : todo;
  s.todo = list.length;
  log("briefs", `${list.length} 个品类需要生成（week_start=${week}）`);

  const r = await pool(list, ctx.cfg.llm.concurrency, async ({ cc, genre }) => {
    const input = await buildInput(ctx, cc, genre);
    if (!input) return;
    const out = await llm.json(BriefSchema, [
      { role: "system", content: SYSTEM },
      { role: "user", content: JSON.stringify(input.payload) },
    ], 3000);
    if (!out) { s.failed++; return; }
    out.new_entries = out.new_entries.filter((x) => input.appIds.has(x.app_id));
    out.movers = out.movers.filter((x) => input.appIds.has(x.app_id));
    for (const p of out.pain_points) p.example_review_ids = p.example_review_ids.filter((id) => input.reviewIds.has(id)).slice(0, 3);
    await ctx.db!.insert(categoryBriefs)
      .values({ country: cc, genreId: genre, weekStart: week, brief: out, model: ctx.cfg.llm.model, createdAt: new Date() })
      .onConflictDoUpdate({
        target: [categoryBriefs.country, categoryBriefs.genreId, categoryBriefs.weekStart],
        set: { brief: out, model: ctx.cfg.llm.model, createdAt: new Date() },
      });
    s.generated++;
    log("briefs", `${cc}/${GENRES[genre]?.zh} 完成：${out.headline}`);
  });
  s.stopped_by_budget = r.stoppedByBudget;
  job.stats = { ...s, llm: llm.stats };
  return job.finish();
}

async function buildInput(ctx: Ctx, cc: Country, genre: number) {
  const db = ctx.db!;
  const f = ctx.cfg.flags;
  const charts: Record<string, unknown>[] = [];
  const top50 = new Set<number>();
  const mentioned = new Set<number>();
  let historyDays = 0;

  for (const chart of CHART_TYPES) {
    const snaps = await db.execute<{ d: string; ids: number[] }>(sql`
      select snapshot_date::text d, app_ids::float8[] ids from chart_snapshots
      where country = ${cc} and genre_id = ${genre} and chart_type = ${chart}
        and snapshot_date between ${ctx.date}::date - 7 and ${ctx.date}::date
      order by snapshot_date`);
    const cur = snaps.at(-1);
    if (!cur) continue;
    const prev = snaps.slice(0, -1);
    historyDays = Math.max(historyDays, prev.length);
    const rankNow = new Map(cur.ids.map((id, i) => [id, i + 1]));
    cur.ids.slice(0, 50).forEach((id) => top50.add(id));
    const seenBefore = new Set(prev.flatMap((p) => p.ids));
    const base = prev[0]; // 窗口里最早的一天，作为比较基准
    const rankBase = new Map((base?.ids ?? []).map((id, i) => [id, i + 1]));

    const newEntries = prev.length ? cur.ids.map((id, i) => ({ app_id: id, rank: i + 1 })).filter((x) => !seenBefore.has(x.app_id)).slice(0, 10) : [];
    const moves = cur.ids
      .filter((id) => rankBase.has(id))
      .map((id) => ({ app_id: id, rank_now: rankNow.get(id)!, rank_before: rankBase.get(id)!, delta: rankBase.get(id)! - rankNow.get(id)! }));
    const up = moves.filter((m) => m.delta >= 5).sort((a, b) => b.delta - a.delta).slice(0, 8);
    const down = moves.filter((m) => m.delta <= -5).sort((a, b) => a.delta - b.delta).slice(0, 8);
    const dropped = (base?.ids ?? []).slice(0, 50).filter((id) => !rankNow.has(id)).slice(0, 8).map((id) => ({ app_id: id, rank_before: rankBase.get(id) }));
    [...newEntries, ...up, ...down, ...dropped].forEach((x) => mentioned.add(x.app_id));
    charts.push({
      chart: CHART_ZH[chart], latest_date: cur.d, compared_with: base?.d ?? null,
      new_entries: newEntries, risers: up, fallers: down, dropped_out_of_top50: dropped,
      top10: cur.ids.slice(0, 10).map((id, i) => ({ app_id: id, rank: i + 1 })),
    });
    cur.ids.slice(0, 10).forEach((id) => mentioned.add(id));
  }
  if (charts.length === 0) return null;

  // 低评分高排名：本品类任一榜单排名 ≤ 阈值且评分 < 阈值
  const lowHighRows = await db.execute<{ app_id: number; best_rank: number }>(sql`
    select u.app_id::float8 app_id, min(u.rank)::int best_rank
    from chart_snapshots s, unnest(s.app_ids) with ordinality u(app_id, rank)
    join apps a on a.app_id = u.app_id and a.country = ${cc}
    where s.country = ${cc} and s.genre_id = ${genre}
      and s.snapshot_date = (select max(snapshot_date) from chart_snapshots where country = ${cc} and snapshot_date <= ${ctx.date})
      and u.rank <= ${f.low_rating_max_rank} and a.rating_avg < ${f.low_rating_threshold}
    group by 1 order by 2`);
  lowHighRows.forEach((x) => mentioned.add(x.app_id));
  const allIds = [...new Set([...top50, ...mentioned])];
  const dir = await db.execute<{ app_id: number; name: string; developer: string | null; rating: number | null; rating_count: number | null; genre_id: number | null; version: string | null; version_date: string | null; one_liner: string | null; about: string | null }>(sql`
    select a.app_id::float8 app_id, a.name, a.developer, a.rating_avg::float8 rating, a.rating_count, a.primary_genre_id genre_id,
           a.version, a.version_date::date::text version_date,
           s.summary->>'one_liner' one_liner,
           left(regexp_replace(split_part(btrim(a.description), chr(10), 1), '[[:space:]]+', ' ', 'g'), 100) about
    from apps a
    left join lateral (select summary from app_summaries where app_id = a.app_id and country = a.country order by week_start desc limit 1) s on true
    where a.country = ${cc} and a.app_id = any(${pgIntArray(allIds)}::bigint[])`);
  const info = new Map(dir.map((d) => [d.app_id, d]));


  // 品类前 50 的 App 近 30 天评论标签统计，以及按 App 均衡抽样的低分评论
  const ids50 = [...top50];
  const topicRows = await db.execute<{ topic: string; n: number; apps: number }>(sql`
    select t topic, count(*)::int n, count(distinct app_id)::int apps
    from reviews, unnest(topics) t
    where country = ${cc} and app_id = any(${pgIntArray(ids50)}::bigint[]) and reviewed_at > now() - interval '30 days' and rating <= 3
    group by 1 order by 2 desc`);
  const samples = await db.execute<{ id: string; app_id: number; r: number; g: string | null; topics: string[] | null; c: string }>(sql`
    select id, app_id, r, g, topics, c from (
      select review_id id, app_id::float8 app_id, rating::int r, gist g, topics, left(coalesce(title || '：', '') || content, 200) c,
             row_number() over (partition by app_id order by reviewed_at desc) rn
      from reviews
      where country = ${cc} and app_id = any(${pgIntArray(ids50)}::bigint[]) and reviewed_at > now() - interval '30 days' and rating <= 3
    ) x where rn <= 3 order by random() limit 120`);

  const appIds = new Set([...mentioned, ...samples.map((x) => x.app_id)]);
  const appDir = [...appIds].map((id) => {
    const a = info.get(id);
    return a ? { app_id: id, name: a.name, developer: a.developer, rating: a.rating, rating_count: a.rating_count, version: a.version, version_date: a.version_date, is_game: a.genre_id === 6014, about: a.one_liner ?? a.about } : { app_id: id };
  });

  const payload = {
    country: cc, category: GENRES[genre]?.zh, history_days: historyDays,
    thresholds: { low_rating: f.low_rating_threshold, high_rank: f.low_rating_max_rank },
    charts,
    low_rating_high_rank: lowHighRows.map((x) => ({ app_id: x.app_id, best_rank: x.best_rank, rating: info.get(x.app_id)?.rating ?? null })),
    topic_stats_low_rating_30d: topicRows.map((t) => ({ topic: TOPICS[t.topic as Topic]?.label ?? t.topic, reviews: t.n, apps: t.apps })),
    low_rating_samples: samples,
    apps: appDir,
  };
  return { payload, appIds, reviewIds: new Set(samples.map((x) => x.id)) };
}

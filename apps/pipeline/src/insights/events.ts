/**
 * 机会事件（docs/opportunity-method.md）。
 *   events      找事件（不调 AI）：上架一年内、日均评分增速在本国领先、近 7 天还在涨的新 App
 *   checks      复核（不调 AI）：触发后第 30 / 90 天，看它是否还在涨
 *   eventcards  拆解（调 AI）：按「钱在哪、进得去吗、什么在变、赢家为什么赢、我们的切口」写卡片
 */
import { GENRES, opportunityEvents } from "@app-radar/shared";
import { sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { pgTextArray } from "../stages/scope.ts";
import { ask, log, recordStep, type RunCtx } from "./runner.ts";

export const EVENT_CARD_VERSION = "event-card-v2"; // v2：正文不出现评论 id 和字段名，榜单写成中文

type Metrics = {
  age: number; ratings: number; per_day: number; per_day_7d: number | null; rank: number;
  rating_avg: number | null; best_rank: number | null; best_chart: string | null; suspicious: boolean | null; older_apps: string[];
};

const intArray = (xs: number[]) => `{${xs.join(",")}}`;
const CHART_ZH: Record<string, string> = { free: "免费榜", paid: "付费榜", grossing: "畅销榜" };
/** "6007:free" → "效率免费榜"；0 是总榜 */
export const chartZh = (c: unknown) => {
  if (typeof c !== "string" || !c.includes(":")) return c ?? null;
  const [g, t] = c.split(":");
  return `${Number(g) === 0 ? "总" : GENRES[Number(g)]?.zh ?? g}${CHART_ZH[t!] ?? t}`;
};
const withChartZh = <T extends Record<string, unknown>>(rows: T[]) => rows.map((r) => ({ ...r, best_chart: chartZh(r.best_chart) }));

/** 找事件：每个国家按日均评分增速取前 N 个，新出现的插入，已有的更新 latest_metrics */
export async function runEvents(ctx: RunCtx) {
  const started = new Date();
  const e = ctx.cfg.insights.events;
  const genres = ctx.genres ?? ctx.cfg.insights.include_genres;
  const rows = await ctx.db.execute<{ country: string; app_id: number; name: string; on: string } & Metrics>(sql`
    with d as (select max(snapshot_date) d from app_rating_daily),
    last as (select r.app_id, r.country, r.rating_count rc, r.rating_avg from app_rating_daily r, d where r.snapshot_date = d.d),
    prev as (select r.app_id, r.country, r.rating_count rc from app_rating_daily r, d where r.snapshot_date = d.d - 7),
    sig as (select distinct on (app_id, country) app_id, country, best_rank, best_chart, suspicious from app_signals order by app_id, country, snapshot_date desc),
    base as (
      select a.country, a.app_id, a.name, a.developer_id, a.release_date::date rel, d.d,
             (d.d - a.release_date::date) age, l.rc, l.rating_avg,
             l.rc::numeric / greatest(d.d - a.release_date::date, 1) per_day,
             (l.rc - p.rc)::numeric / 7 per_day_7d,
             s.best_rank, s.best_chart, s.suspicious
      from apps a cross join d
      join last l using (app_id, country) left join prev p using (app_id, country)
      left join developers dv on dv.developer_id = a.developer_id
      left join sig s using (app_id, country)
      where a.release_date >= d.d - ${e.max_age_days}::int
        and a.primary_genre_id = any(${intArray(genres)}::int[])
        and a.country = any(${pgTextArray(ctx.countries)}::text[])
        and coalesce(dv.type, 'normal') = 'normal'
    ),
    ranked as (
      select b.*, row_number() over (partition by country order by per_day desc) rk from base b
      where rc >= ${e.min_ratings} and age >= ${e.min_age_days}
        and coalesce(per_day_7d / nullif(per_day, 0), 1) >= ${e.min_recent_ratio}
    )
    select r.country, r.app_id::float8 app_id, r.name, r.d::text "on", r.age, r.rc ratings, r.rating_avg::float8 rating_avg,
           round(r.per_day, 1)::float8 per_day, round(r.per_day_7d, 1)::float8 per_day_7d, r.rk::int rank,
           r.best_rank, r.best_chart, r.suspicious,
           coalesce((select array_agg(distinct o.name) from apps o where o.developer_id = r.developer_id and o.app_id <> r.app_id
                       and o.release_date < r.rel - 30 and o.rating_count >= 1000), '{}') older_apps
    from ranked r where rk <= ${e.top_per_country} order by country, rk`);

  const s = { found: rows.length, new: 0 };
  for (const r of rows) {
    const m: Metrics = {
      age: r.age, ratings: r.ratings, per_day: r.per_day, per_day_7d: r.per_day_7d, rank: r.rank, rating_avg: r.rating_avg,
      best_rank: r.best_rank, best_chart: r.best_chart, suspicious: r.suspicious, older_apps: r.older_apps,
    };
    const [x] = await ctx.db.insert(opportunityEvents)
      .values({ kind: "rising", appId: r.app_id, country: r.country, detectedOn: r.on, firstMetrics: m, latestOn: r.on, latestMetrics: m })
      .onConflictDoUpdate({
        target: [opportunityEvents.kind, opportunityEvents.appId, opportunityEvents.country],
        set: { latestOn: r.on, latestMetrics: m },
      })
      .returning({ fresh: sql<boolean>`xmax = 0` });
    if (x?.fresh) { s.new++; log("events", `新事件 ${r.country} #${r.rank} ${r.name}（上架 ${r.age} 天，${r.ratings} 条评分，日均 ${r.per_day}）`); }
  }
  log("events", `本次名单 ${s.found} 个，其中新事件 ${s.new} 个`);
  await recordStep(ctx, "events", started, s, "ok");
  return s;
}

/** 复核：触发后第 N 天，比较触发以来的日均增速和触发时的日均增速 */
export async function runChecks(ctx: RunCtx) {
  const started = new Date();
  const e = ctx.cfg.insights.events;
  const s = { checked: 0, held: 0, faded: 0 };
  for (const days of e.check_days) {
    const due = await ctx.db.execute<{ id: number; first: Metrics; detected_on: string; status: string; rc: number | null; on: string | null; best_rank: number | null; today: string }>(sql`
      with d as (select max(snapshot_date) d from app_rating_daily)
      select ev.id::float8 id, ev.first_metrics first, ev.detected_on::text detected_on, ev.status, l.rating_count rc, l.snapshot_date::text "on",
             (select best_rank from app_signals x where x.app_id = ev.app_id and x.country = ev.country order by snapshot_date desc limit 1) best_rank,
             d.d::text today
      from opportunity_events ev cross join d
      left join lateral (select rating_count, snapshot_date from app_rating_daily r where r.app_id = ev.app_id and r.country = ev.country
                         order by snapshot_date desc limit 1) l on true
      where ev.detected_on <= d.d - ${days}::int and not ev.checks ? ${String(days)}
        and ev.country = any(${pgTextArray(ctx.countries)}::text[])`);
    for (const ev of due) {
      const since = (Date.parse(ev.today) - Date.parse(ev.detected_on)) / 86_400_000;
      // 一周以上没有评分数据，说明已经掉出我们跟踪的榜单
      const dropped = ev.on === null || Date.parse(ev.today) - Date.parse(ev.on) > 7 * 86_400_000;
      const perDay = ev.rc === null ? null : Math.round(((ev.rc - ev.first.ratings) / Math.max(since, 1)) * 10) / 10;
      const held = !dropped && perDay !== null && perDay >= ev.first.per_day * e.held_ratio;
      const check = { on: ev.today, ratings: ev.rc, per_day_since: perDay, best_rank: ev.best_rank, dropped, held };
      const status = ev.status === "skip" ? "skip" : held ? "held" : "faded";
      await ctx.db.execute(sql`
        update opportunity_events set checks = checks || jsonb_build_object(${String(days)}::text, ${JSON.stringify(check)}::jsonb), status = ${status}
        where id = ${ev.id}`);
      s.checked++;
      if (held) s.held++; else s.faded++;
    }
  }
  log("checks", `复核 ${s.checked} 个：还在涨 ${s.held}，已停涨 ${s.faded}`);
  await recordStep(ctx, "checks", started, s, "ok");
  return s;
}

const text = z.string().catch("").transform((t) => t.trim());
export const EVENT_VERDICTS = ["follow", "watch", "skip"] as const;
export const EventCardSchema = z.object({
  verdict: z.string().transform((v) => {
    const x = v.trim().toLowerCase();
    return (x.includes("follow") || x.includes("跟进") ? "follow" : x.includes("watch") || x.includes("观察") ? "watch" : "skip") as (typeof EVENT_VERDICTS)[number];
  }),
  verdict_reason: z.string().min(4).transform((t) => t.trim()),
  headline: z.string().min(4).transform((t) => t.trim().slice(0, 60)),
  market: z.object({ pool: text, openness: text }).catch({ pool: "", openness: "" }),
  winner: z.object({ who: text, positioning: text, monetization: text, acquisition: text }).catch({ who: "", positioning: "", monetization: "", acquisition: "" }),
  whose_users: text,
  why_now: text,
  angles: z.array(z.object({ who: text, positioning: text, vs_winner: text, acquisition: text, why_incumbents_wont_follow: text })).catch([]),
  other_markets: text,
  risks: z.array(z.string()).catch([]),
  kill_criteria: text,
  quote_ids: z.array(z.coerce.string()).catch([]),
});
export type EventCard = z.infer<typeof EventCardSchema>;

const SYSTEM = `你是应用市场的产品机会分析师，工作方式和 Sensor Tower、AppMagic 的研究员以及系统挑品类的应用工作室一样：先看钱和用户往哪里流，再拆解赢的人为什么赢，最后找一个小团队能做的切口。评论只用来解释现象和当证据。

给你一个数据事件：一个上架不到一年的 App，日均评分增速在这个国家的新 App 里排在前列（event）。还给你：这个 App 的商店信息（app）、近两周的评分数（ratings_daily）、它的评论（reviews）、同一细分场景里的其他 App（scene_apps，互为替代品）、场景的开放度（openness）、同场景用户提到换用或竞品的评论摘录（switching）、别国同场景的情况（other_markets）、同一开发者更早的产品（event.older_apps）。

评分数大致随下载量增长，但各 App 比例差很多；畅销榜名次代表在赚钱，免费榜名次代表下载多。不要换算成下载量或收入金额。

按顺序回答：
1. 钱在哪里、多大：这个场景有没有人在付钱（scene_apps 在畅销榜的名次、价格），用户量级大概如何。
2. 市场进得去吗：近两年有没有新 App 挤进前列（openness），头部是不是老牌、大公司或靠网络效应。
3. 什么在变：这个 App 为什么现在起量。常见原因有：新能力（如 AI 拍照识别）、新人群、新获客渠道（短视频、激励）、新的收钱方式、从别国搬来。
4. 赢家为什么赢：做给谁、怎么定位（引用商店页原话）、怎么收钱、可能怎么获客（推测要写「推测」）。
5. 抢了谁的用户：只依据 switching 和 reviews 里的原话；没有证据就写「没有证据」。
6. 我们的切口：最多 2 个，小团队能做。每个写清人群、定位、和赢家的差别、获客路径、在位者为什么不会马上跟进。切口可以是：搬到别的国家、切出更窄的人群、换收钱方式、在体验更差的在位者那边抢用户。说不出站得住的切口就不要硬写。

先下结论 verdict：
- follow（值得跟进）：起量是真的，原因说得清，而且有一个小团队能做、站得住的切口
- watch（观察）：起量是真的，但切口还说不清，或者要看它能不能持续（等 30 / 90 天复核）
- skip（噪声）：刷量或激励换评分、灰色或违规（盗版内容、规避监管）、其实是大公司或成熟品牌的新产品、继承老版本的重新上架、纯买量的换皮产品且没有可学的东西

只输出 JSON（简体中文）：
{
  "verdict": "follow / watch / skip",
  "verdict_reason": "一两句，具体到这个 App 和场景",
  "headline": "一句话：谁、在什么场景、靠什么定位跑出来了，30 字以内",
  "market": {"pool": "钱和用户量的判断，引用输入里的名次和评分数", "openness": "市场开不开"},
  "winner": {"who": "做给谁", "positioning": "怎么定位，引用商店页原话", "monetization": "怎么收钱", "acquisition": "可能怎么获客"},
  "whose_users": "抢了谁的用户及证据",
  "why_now": "为什么现在起量",
  "angles": [{"who": "人群", "positioning": "定位", "vs_winner": "和赢家的差别", "acquisition": "获客路径", "why_incumbents_wont_follow": "在位者为什么不会马上跟进"}],
  "other_markets": "别国有没有对应产品；搬过去是否成立（文化、法规、支付习惯）",
  "risks": ["2–4 条"],
  "kill_criteria": "出现什么情况就放弃，最好可观察，如「30 天复核时日均增速掉到一半以下」",
  "quote_ids": ["2–4 个最能说明问题的评论 id，来自 reviews 或 switching"]
}

只依据输入，不编造数字和事实；quote_ids 只能用输入里出现过的 id。verdict 为 skip 时，angles 可以为空数组。
写法：
- 正文里不要出现评论 id、字段名和内部代号（如 ranked_top50、per_day_7d、dev_type、scene_apps）。要引用评论就直接写评论原话的要点，id 只放进 quote_ids。
- 榜单写成输入里的中文名，如「效率免费榜第 37」。
- 每个字段 1–3 句，只写改变判断的信息，不要罗列所有数字。`;
export const eventCardBench = { SYSTEM };

type EventRow = { id: number; app_id: number; country: string; first: Metrics; latest: Metrics; detected_on: string };

/** 写卡片的输入 */
export async function eventCardInput(db: RunCtx["db"], ev: EventRow) {
  const [app] = await db.execute<Record<string, unknown> & { developer_id: number | null; genre: number }>(sql`
    select a.name, a.developer, a.developer_id::float8 developer_id, coalesce(dv.type, 'normal') dev_type, a.price::float8 price, a.currency,
           a.rating_avg::float8 rating, a.rating_count, a.release_date::date::text released, a.version_date::date::text updated,
           a.primary_genre_id genre, left(a.description, 1500) description, left(a.release_notes, 300) release_notes
    from apps a left join developers dv on dv.developer_id = a.developer_id
    where a.app_id = ${ev.app_id} and a.country = ${ev.country}`);
  const [scene] = await db.execute<{ name: string; description: string | null }>(sql`
    select s.name, s.description from app_scenes x join scenes s on s.id = x.scene_id where x.app_id = ${ev.app_id}`);
  const ratingsDaily = await db.execute<{ d: string; n: number }>(sql`
    select snapshot_date::text d, rating_count n from app_rating_daily
    where app_id = ${ev.app_id} and country = ${ev.country} order by snapshot_date desc limit 14`);

  // 同场景（按场景名，跨品类）的 App；other_markets 同理
  const peers = (cc: string, limit: number) => scene ? db.execute<Record<string, unknown>>(sql`
    select a.app_id::float8 app_id, a.name, a.developer, coalesce(dv.type, 'normal') dev_type, a.price::float8 price, a.rating_avg::float8 rating,
           a.rating_count, extract(year from a.release_date)::int released_year, s.best_rank, s.best_chart, s.days_since_update
    from app_scenes x join scenes sc on sc.id = x.scene_id
    join apps a on a.app_id = x.app_id and a.country = ${cc}
    left join developers dv on dv.developer_id = a.developer_id
    left join lateral (select * from app_signals y where y.app_id = a.app_id and y.country = a.country order by snapshot_date desc limit 1) s on true
    where sc.name = ${scene.name} and a.app_id <> ${ev.app_id}
    order by s.best_rank nulls last, a.rating_count desc nulls last limit ${limit}`) : Promise.resolve([]);
  const sceneApps = withChartZh(await peers(ev.country, 10));
  const [openness] = scene ? await db.execute<Record<string, number>>(sql`
    select count(*)::int "收录的同场景 App",
           count(*) filter (where s.best_rank <= 50)::int "进过榜单前 50 的",
           count(*) filter (where s.best_rank <= 50 and a.release_date >= current_date - 730)::int "其中近两年上架的"
    from app_scenes x join scenes sc on sc.id = x.scene_id join apps a on a.app_id = x.app_id and a.country = ${ev.country}
    left join lateral (select best_rank from app_signals y where y.app_id = a.app_id and y.country = a.country order by snapshot_date desc limit 1) s on true
    where sc.name = ${scene.name}`) : [];
  const otherMarkets: Record<string, unknown> = {};
  for (const cc of ["us", "jp", "cn"].filter((c) => c !== ev.country)) {
    const [self] = await db.execute<{ best_rank: number | null; rating_count: number | null }>(sql`
      select (select best_rank from app_signals y where y.app_id = a.app_id and y.country = a.country order by snapshot_date desc limit 1) best_rank, a.rating_count
      from apps a where a.app_id = ${ev.app_id} and a.country = ${cc}`);
    otherMarkets[cc] = { this_app: self ?? "不在这个国家的榜单上", scene_apps: withChartZh(await peers(cc, 5)) };
  }

  // 这个 App 的评论：最近的、最低分的、最多人点有用的，去重后最多 30 条
  const reviews = await db.execute<{ id: string; stars: number; date: string; text: string }>(sql`
    with r as (
      select review_id id, rating::int stars, reviewed_at::date::text date, left(coalesce(title || '：', '') || content, 280) text,
             row_number() over (order by reviewed_at desc) by_recent, row_number() over (order by rating, reviewed_at desc) by_low,
             row_number() over (order by vote_sum desc nulls last) by_votes
      from reviews where app_id = ${ev.app_id} and country = ${ev.country})
    select id, stars, date, text from r where by_recent <= 15 or by_low <= 8 or by_votes <= 7 order by date desc limit 30`);
  // 同场景里提到换用或竞品的评论摘录：谁的用户在流失、流向哪里
  const switching = scene ? await db.execute<{ id: string; app: string; stars: number; statement: string; competitor: string | null }>(sql`
    select st.review_id id, a.name app, st.rating::int stars, st.text statement, st.competitor
    from review_statements st join app_scenes x on x.app_id = st.app_id join scenes sc on sc.id = x.scene_id
    join apps a on a.app_id = st.app_id and a.country = st.country
    where sc.name = ${scene.name} and st.country = ${ev.country} and (st.churn or st.competitor is not null)
    order by st.reviewed_at desc limit 15`) : [];

  const input = {
    event: {
      kind: "新 App 起量", country: ev.country, detected_on: ev.detected_on,
      at_detection: { ...ev.first, best_chart: chartZh(ev.first.best_chart) }, latest: { ...ev.latest, best_chart: chartZh(ev.latest.best_chart) },
    },
    app: { ...app, genre: GENRES[app?.genre ?? 0]?.zh, developer_id: undefined },
    scene, ratings_daily: ratingsDaily, scene_apps: sceneApps, openness, switching, other_markets: otherMarkets, reviews,
  };
  return { input, quoteIds: new Set([...reviews.map((r) => r.id), ...switching.map((r) => r.id)]), name: String(app?.name ?? ev.app_id) };
}

/** 给还没有卡片（或提示词版本变了）的事件写卡片；按触发时的名次先后 */
export async function runEventCards(ctx: RunCtx) {
  const started = new Date();
  const s = { candidates: 0, written: 0, failed: 0, follow: 0, watch: 0, skip: 0 };
  const todo = await ctx.db.execute<EventRow>(sql`
    select id::float8 id, app_id::float8 app_id, country, first_metrics first, latest_metrics latest, detected_on::text detected_on
    from opportunity_events
    where (card is null or card_version <> ${EVENT_CARD_VERSION}) and country = any(${pgTextArray(ctx.countries)}::text[])
    order by detected_on desc, (latest_metrics->>'rank')::int`);
  s.candidates = todo.length;
  let next = 0;
  const write = async (ev: EventRow) => {
    const { input, quoteIds, name } = await eventCardInput(ctx.db, ev);
    const out = await ask(ctx, EventCardSchema, SYSTEM, JSON.stringify(input));
    if (!out) { if (!ctx.stopped) s.failed++; return; }
    out.quote_ids = out.quote_ids.filter((id) => quoteIds.has(id)).slice(0, 4);
    out.angles = out.angles.slice(0, 2);
    await ctx.db.execute(sql`
      update opportunity_events set card = ${JSON.stringify(out)}::jsonb, card_version = ${EVENT_CARD_VERSION},
        card_provider = ${ctx.provider}, card_model = ${ctx.model ?? "(默认)"}, card_at = now(),
        status = case when ${out.verdict} = 'skip' then 'skip' when status = 'skip' then 'watching' else status end
      where id = ${ev.id}`);
    s.written++;
    s[out.verdict]++;
    log("eventcards", `${ev.country} ${name}：[${out.verdict}] ${out.headline}（调用 ${ctx.calls}）`);
  };
  const worker = async () => { while (!ctx.stopped && next < todo.length) await write(todo[next++]!); };
  await Promise.all(Array.from({ length: Math.min(ctx.concurrency, todo.length) }, worker));
  await recordStep(ctx, "eventcards", started, s, ctx.stopped ? "partial" : "ok");
  return s;
}

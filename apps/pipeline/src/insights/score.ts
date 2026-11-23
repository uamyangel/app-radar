/**
 * S4 打分（纯程序，可随时重算）：按国家算每个需求的十个维度和排序分（docs/insights-design.md 第 2、3 节）。
 * 排序分 = 证据 × 市场 × 缺口 × 可行；任何一项接近零的都排不上来。
 */
import { needMetrics } from "@app-radar/shared";
import { sql } from "@app-radar/shared/orm";
import { pgTextArray } from "../stages/scope.ts";
import { isGeneric } from "./generic.ts";
import { log, recordStep, type RunCtx } from "./runner.ts";

/** Wilson 置信区间下界：样本小时自动压低，3 条里 2 条 ≠ 67% */
export function wilsonLb(k: number, n: number, z = 1.96): number {
  if (n === 0) return 0;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.max(0, (c - m) / d);
}
const clamp = (x: number) => Math.max(0, Math.min(1, x));

type AppRow = {
  need_id: number; country: string; app_id: number; mentions: number; analyzed: number;
  churn: number; pay: number; one_star: number; developer_id: number | null; weeks: string[];
  best_rank: number | null; on_grossing: boolean | null; tags: string[] | null; dev_type: string | null;
  review_avg: number | null; genre_median: number | null; name: string;
};

export function computeMetrics(rows: AppRow[], kind: string, cfg: RunCtx["cfg"], generic = false) {
  const p = cfg.insights.pipeline;
  const mentions = rows.reduce((a, r) => a + r.mentions, 0); // 同一条评论只会属于一个 App，所以可以直接相加
  const apps = rows.length;
  const developers = new Set(rows.map((r) => r.developer_id ?? `app${r.app_id}`)).size;
  const weeks = new Set(rows.flatMap((r) => r.weeks)).size;
  const churnN = rows.reduce((a, r) => a + r.churn, 0);
  const payN = rows.reduce((a, r) => a + r.pay, 0);
  const oneStar = rows.reduce((a, r) => a + r.one_star, 0);
  const prevalenceLb = Math.max(...rows.map((r) => wilsonLb(r.mentions, Math.max(r.analyzed, r.mentions))));
  const maxAppMentions = Math.max(...rows.map((r) => r.mentions));
  const ranks = rows.map((r) => r.best_rank).filter((x): x is number => x !== null);
  const bestHostRank = ranks.length ? Math.min(...ranks) : null;
  const hostOnGrossing = rows.some((r) => r.on_grossing);
  const hostStale = rows.some((r) => r.tags?.includes("陈旧在榜"));
  const hostWeak = rows.some((r) => r.tags?.includes("口碑差") || r.tags?.includes("口碑下滑")
    || (r.review_avg !== null && r.genre_median !== null && r.review_avg < r.genre_median - 0.5));
  const allHostsMajor = rows.every((r) => r.dev_type === "major");

  // 证据：规模取对数（100 条远强于 1 条，1000 条只比 100 条强一些）× 广度 × 持续性 × 浓度
  const scale = clamp(Math.log2(1 + mentions) / Math.log2(1 + 40));
  const breadth = apps >= 3 ? 1 : apps === 2 ? 0.85 : 0.65;
  const persistence = weeks >= 4 ? 1 : weeks === 3 ? 0.9 : weeks === 2 ? 0.8 : 0.65;
  const evidence = clamp(scale * breadth * persistence * (0.7 + 0.3 * clamp(prevalenceLb / 0.3)));
  // 市场：承载 App 的最好名次，在畅销榜上加分
  const rankF = bestHostRank === null ? 0.4 : bestHostRank <= 10 ? 1 : bestHostRank <= 25 ? 0.85 : bestHostRank <= 50 ? 0.7 : 0.55;
  const market = clamp(rankF + (hostOnGrossing ? 0.15 : 0));
  // 缺口：承载 App 停更、口碑差，用户在流失、愿意付费
  const gap = clamp(0.35 + (hostStale ? 0.25 : 0) + (hostWeak ? 0.2 : 0) + 0.2 * clamp((churnN / Math.max(1, mentions)) * 3) + 0.1 * clamp((payN / Math.max(1, mentions)) * 5));
  // 可行：诉求类型；对手全是大公司时略降
  const feasibility = clamp((p.feasibility_by_kind[kind] ?? 0.4) * (allHostsMajor ? 0.85 : 1));
  const score = evidence * market * gap * feasibility;

  const main = (mentions >= p.main_min_mentions && apps >= p.main_min_apps)
    || (maxAppMentions >= p.main_single_app_mentions && prevalenceLb >= p.main_single_app_prevalence);

  return {
    mentions, apps, developers, weeksActive: weeks, churnN, payN,
    oneStarShare: Number((oneStar / Math.max(1, mentions)).toFixed(3)), prevalenceLb: Number(prevalenceLb.toFixed(3)),
    bestHostRank, hostOnGrossing, hostStale, hostWeak, allHostsMajor,
    evidence: Number(evidence.toFixed(3)), market: Number(market.toFixed(3)), gap: Number(gap.toFixed(3)),
    // 通用抱怨不上主列表、不出卡片，只作为品类的共性痛点背景
    feasibility: Number(feasibility.toFixed(3)), score: Number(score.toFixed(4)), tier: generic ? "generic" : main ? "main" : "watch",
    hostApps: rows.sort((a, b) => b.mentions - a.mentions).map((r) => ({
      appId: r.app_id, name: r.name, mentions: r.mentions, analyzed: r.analyzed, bestRank: r.best_rank,
      stale: r.tags?.includes("陈旧在榜") ?? false, reviewAvg: r.review_avg, devType: r.dev_type,
    })),
  };
}

export async function runScore(ctx: RunCtx) {
  const started = new Date();
  // 「通用抱怨」按当前规则重算（纯程序），规则调整后重新打分即可生效
  const all = await ctx.db.execute<{ id: number; kind: string; object: string | null; generic: boolean }>(sql`
    select id::float8 id, kind, object, generic from needs where not retired and merged_into is null`);
  const flip = all.filter((n) => isGeneric(n.kind, n.object) !== n.generic);
  for (const n of flip) await ctx.db.execute(sql`update needs set generic = ${!n.generic}, updated_at = now() where id = ${n.id}`);
  if (flip.length) {
    log("score", `按规则更新了 ${flip.length} 个需求的「通用抱怨」标记`);
    await ctx.db.execute(sql`delete from opportunity_cards c using needs n where n.id = c.need_id and (n.generic or n.retired)`);
  }
  const w = ctx.cfg.insights.pipeline.window_days;
  // 每个 (需求, 国家, App)：提及数、该 App 被分析的评论数（浓度的分母）、最新市场信号
  const rows = await ctx.db.execute<AppRow & { kind: string; generic: boolean }>(sql`
    with st as (
      select coalesce(n.merged_into, s.need_id) need_id, s.country, s.app_id, s.review_id, s.rating, s.reviewed_at, s.churn, s.pay
      from review_statements s join needs n on n.id = s.need_id
      join apps sa on sa.app_id = s.app_id and sa.country = s.country
      left join developers sd on sd.developer_id = sa.developer_id
      where not n.retired and coalesce(sd.type, 'normal') in ('major', 'normal') and s.reviewed_at > now() - make_interval(days => ${w}) and s.country = any(${pgTextArray(ctx.countries)}::text[])),
    per as (
      select need_id, country, app_id,
        count(distinct review_id)::int mentions,
        count(distinct review_id) filter (where churn)::int churn,
        count(distinct review_id) filter (where pay)::int pay,
        count(distinct review_id) filter (where rating = 1)::int one_star,
        array_agg(distinct to_char(date_trunc('week', reviewed_at), 'YYYY-MM-DD')) filter (where reviewed_at > now() - interval '84 days') weeks
      from st group by 1, 2, 3),
    analyzed as (
      select e.app_id, e.country, count(*)::int n from review_extractions e join reviews r on r.review_id = e.review_id
      where r.reviewed_at > now() - make_interval(days => ${w}) group by 1, 2),
    sig as (
      select distinct on (app_id, country) app_id, country, best_rank, on_grossing, tags, dev_type, review_avg_90d, genre_review_median
      from app_signals order by app_id, country, snapshot_date desc)
    select per.need_id::float8 need_id, per.country, per.app_id::float8 app_id, per.mentions, coalesce(an.n, per.mentions) analyzed,
      per.churn, per.pay, per.one_star, a.developer_id::float8 developer_id, coalesce(per.weeks, '{}') weeks, a.name,
      sig.best_rank, sig.on_grossing, sig.tags, sig.dev_type, sig.review_avg_90d::float8 review_avg, sig.genre_review_median::float8 genre_median,
      n.kind, n.generic
    from per
    join needs n on n.id = per.need_id
    join apps a on a.app_id = per.app_id and a.country = per.country
    left join analyzed an on an.app_id = per.app_id and an.country = per.country
    left join sig on sig.app_id = per.app_id and sig.country = per.country`);

  const groups = new Map<string, (AppRow & { kind: string; generic: boolean })[]>();
  for (const r of rows) {
    const k = `${r.need_id}|${r.country}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const today = new Date().toISOString().slice(0, 10);
  const values = [...groups.entries()].map(([k, rs]) => {
    const [needId, country] = k.split("|");
    return { needId: Number(needId), country: country!, computedOn: today, ...computeMetrics(rs, rs[0]!.kind, ctx.cfg, rs[0]!.generic) };
  });
  // 整体替换这些国家的指标（需求被合并或证据移出窗口后，旧行要消失）
  await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`delete from need_metrics where country = any(${pgTextArray(ctx.countries)}::text[])`);
    for (let i = 0; i < values.length; i += 500) await tx.insert(needMetrics).values(values.slice(i, i + 500));
  });
  const main = values.filter((v) => v.tier === "main").length;
  const generic = values.filter((v) => v.tier === "generic").length;
  log("score", `${values.length} 个（需求 × 国家）：主列表 ${main}，通用抱怨 ${generic}，待观察 ${values.length - main - generic}`);
  await recordStep(ctx, "score", started, { rows: values.length, main }, "ok");
  return { rows: values.length, main };
}

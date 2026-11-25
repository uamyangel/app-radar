import { sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { api, AppId, Country, notFound } from "../../_lib/api.ts";
import type { NeedResp } from "../../_lib/types.ts";

const Q = z.object({ id: AppId, country: Country });

/** 需求详情：指标、卡片、承载 App、每周提及数、卡片引用的原话 */
export const onRequestGet = api(Q, async (q, db): Promise<NeedResp> => {
  const [need] = await db.execute<NeedResp["need"] & { merged_into: number | null }>(sql`
    select n.id::float8 id, n.genre_id "genreId", sc.name "sceneName", sc.description "sceneDesc", n.title, n.description, n.kind, n.adaptation, n.scope,
      n.merged_into::float8 merged_into
    from needs n left join scenes sc on sc.id = n.scene_id where n.id = ${q.id}`);
  if (!need) throw notFound("没有这个需求");
  const id = need.merged_into ?? need.id; // 被合并的需求，展示合并后的那个
  const [m] = await db.execute<NeedResp["metrics"] & { host_apps: NeedResp["hostApps"] }>(sql`
    select mentions, apps, developers, weeks_active "weeksActive", churn_n "churnN", pay_n "payN",
      one_star_share::float8 "oneStarShare", prevalence_lb::float8 "prevalenceLb", best_host_rank "bestHostRank",
      host_on_grossing "hostOnGrossing", host_stale "hostStale", host_weak "hostWeak", all_hosts_major "allHostsMajor",
      evidence::float8 evidence, market::float8 market, gap::float8 gap, feasibility::float8 feasibility, score::float8 score, tier, host_apps
    from need_metrics where need_id = ${id} and country = ${q.country}`);
  const [c] = await db.execute<{ card: NeedResp["card"]; provider: string; model: string; created_at: string }>(sql`
    select card, provider, model, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') created_at from opportunity_cards where need_id = ${id} and country = ${q.country}`);
  const hostIds = (m?.host_apps ?? []).map((h) => h.appId);
  const extra = hostIds.length ? await db.execute<{ app_id: number; icon_url: string | null; developer: string | null; rating: number | null; days: number | null; best_chart: string | null }>(sql`
    select a.app_id::float8 app_id, a.icon_url, a.developer, a.rating_avg::float8 rating, s.days_since_update days, s.best_chart
    from apps a left join lateral (select * from app_signals x where x.app_id = a.app_id and x.country = a.country order by snapshot_date desc limit 1) s on true
    where a.country = ${q.country} and a.app_id = any(${`{${hostIds.join(",")}}`}::bigint[])`) : [];
  const ex = new Map(extra.map((e) => [e.app_id, e]));
  const weekly = await db.execute<{ week: string; n: number }>(sql`
    select to_char(date_trunc('week', st.reviewed_at), 'YYYY-MM-DD') week, count(distinct st.review_id)::int n
    from review_statements st join needs n on n.id = st.need_id
    where coalesce(n.merged_into, n.id) = ${id} and st.country = ${q.country} group by 1 order by 1`);
  const quoteIds = c?.card?.quote_ids ?? [];
  const quotes = quoteIds.length ? await db.execute<NeedResp["quotes"][number]>(sql`
    select distinct on (r.review_id) r.review_id "reviewId", r.app_id::float8 "appId", a.name "appName", r.rating::int rating, r.title, r.content,
      to_json(r.reviewed_at)#>>'{}' "reviewedAt", r.lang, st.text statement, st.churn, st.pay, st.competitor
    from reviews r join review_statements st on st.review_id = r.review_id join apps a on a.app_id = r.app_id and a.country = r.country
    where r.review_id = any(${`{${quoteIds.map((x) => x.replace(/[^0-9A-Za-z_-]/g, "")).join(",")}}`}::text[])`) : [];
  const [f] = await db.execute<{ verdict: "up" | "down"; note: string | null; updatedAt: string }>(sql`
    select verdict, note, to_json(updated_at)#>>'{}' "updatedAt" from feedback where need_id = ${id} and country = ${q.country}`);
  const { host_apps: _h, ...metrics } = m ?? ({} as NonNullable<typeof m>);
  return {
    need: {
      id: need.id, genreId: need.genreId, sceneName: need.sceneName, sceneDesc: need.sceneDesc, title: need.title, description: need.description,
      kind: need.kind, adaptation: need.adaptation, scope: need.scope,
    },
    metrics: m ? (metrics as NeedResp["metrics"]) : null,
    card: c?.card ?? null,
    cardMeta: c ? { provider: c.provider, model: c.model, createdAt: c.created_at } : null,
    feedback: f ?? null,
    hostApps: (m?.host_apps ?? []).map((h) => {
      const e = ex.get(h.appId);
      return { ...h, iconUrl: e?.icon_url ?? null, developer: e?.developer ?? null, ratingAvg: e?.rating ?? null, daysSinceUpdate: e?.days ?? null, bestChart: e?.best_chart ?? null };
    }),
    weekly: [...weekly],
    quotes: [...quotes],
  };
}, { cache: false });

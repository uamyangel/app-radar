import { sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { api, Chart, Country, DateStr, Genre } from "../_lib/api.ts";
import type { ChartRow, ChartsResp } from "../_lib/types.ts";

const Q = z.object({ country: Country, genre: Genre, chart: Chart, date: DateStr.optional() });

/** 榜单 + 排名变化所需的原始数据；标签由前端按 config.yaml 的阈值计算 */
export const onRequestGet = api(Q, async (q, db): Promise<ChartsResp> => {
  const key = sql`country = ${q.country} and genre_id = ${q.genre} and chart_type = ${q.chart}`;
  const [d] = await db.execute<{ d: string | null }>(sql`
    select max(snapshot_date)::text d from chart_snapshots where ${key} ${q.date ? sql`and snapshot_date <= ${q.date}` : sql``}`);
  const date = d?.d ?? null;
  if (!date) return { date: null, historyDays: 0, rows: [] };

  const [h] = await db.execute<{ n: number }>(sql`
    select count(*)::int n from chart_snapshots where ${key} and snapshot_date between ${date}::date - 7 and ${date}::date - 1`);
  const rows = await db.execute<ChartRow>(sql`
    with cur as (select app_ids from chart_snapshots where ${key} and snapshot_date = ${date}),
    ranked as (select u.app_id, u.rank::int from cur, unnest(cur.app_ids) with ordinality u(app_id, rank)),
    prev as (select app_ids from chart_snapshots where ${key} and snapshot_date = ${date}::date - 1),
    wk as (select app_ids from chart_snapshots where ${key} and snapshot_date = ${date}::date - 7),
    hist as (
      select u.app_id, max(u.rank)::int worst
      from chart_snapshots s, unnest(s.app_ids) with ordinality u(app_id, rank)
      where ${key} and s.snapshot_date between ${date}::date - 7 and ${date}::date - 1
      group by 1)
    select r.rank, r.app_id::float8 "appId", a.name, a.developer, a.icon_url "iconUrl",
           a.price::float8 price, a.currency, a.rating_avg::float8 "ratingAvg", a.rating_count "ratingCount",
           (select array_position(app_ids, r.app_id) from prev) "prevRank",
           (select array_position(app_ids, r.app_id) from wk) "rank7d",
           h.worst "worst7d",
           s.summary->>'one_liner' "oneLiner",
           nullif(left(regexp_replace(split_part(btrim(a.description), chr(10), 1), '[[:space:]]+', ' ', 'g'), 90), '') snippet,
           (select sig.tags from app_signals sig where sig.app_id = r.app_id and sig.country = ${q.country} and sig.snapshot_date = ${date} and sig.in_scope) "signalTags"
    from ranked r
    left join apps a on a.app_id = r.app_id and a.country = ${q.country}
    left join hist h on h.app_id = r.app_id
    left join lateral (
      select summary from app_summaries where app_id = r.app_id and country = ${q.country} order by week_start desc limit 1
    ) s on true
    order by r.rank`);
  return { date, historyDays: h?.n ?? 0, rows: [...rows] };
});

import { sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { api, AppId, Country } from "../../../_lib/api.ts";
import type { RanksResp } from "../../../_lib/types.ts";

const Q = z.object({ id: AppId, country: Country, days: z.coerce.number().int().min(1).max(365).default(30) });

/** App 在各榜单的排名走势（只返回它出现过的榜单）和评分走势 */
export const onRequestGet = api(Q, async (q, db): Promise<RanksResp> => {
  const since = sql`(select max(snapshot_date) from chart_snapshots where country = ${q.country}) - ${q.days}::int`;
  const rows = await db.execute<{ date: string; genreId: number; chartType: string; rank: number }>(sql`
    select snapshot_date::text date, genre_id "genreId", chart_type "chartType", array_position(app_ids, ${q.id}::bigint) rank
    from chart_snapshots
    where country = ${q.country} and snapshot_date > ${since} and ${q.id}::bigint = any(app_ids)
    order by snapshot_date`);
  const series = new Map<string, RanksResp["series"][number]>();
  for (const r of rows) {
    const k = `${r.genreId}:${r.chartType}`;
    if (!series.has(k)) series.set(k, { genreId: r.genreId, chartType: r.chartType, points: [] });
    series.get(k)!.points.push({ date: r.date, rank: r.rank });
  }
  const ratings = await db.execute<RanksResp["ratings"][number]>(sql`
    select snapshot_date::text date, rating_avg::float8 "ratingAvg", rating_count "ratingCount"
    from app_rating_daily
    where app_id = ${q.id} and country = ${q.country} and snapshot_date > ${since}
    order by snapshot_date`);
  // 按最好名次排序，最重要的榜单排在前面（决定配色顺序）
  const sorted = [...series.values()].sort((a, b) => Math.min(...a.points.map((p) => p.rank)) - Math.min(...b.points.map((p) => p.rank)));
  return { series: sorted, ratings: [...ratings] };
});

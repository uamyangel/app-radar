import { apps, appSummaries } from "@app-radar/shared";
import { and, desc, eq, sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { api, AppId, Country, notFound } from "../../_lib/api.ts";
import type { AppResp, AppSummary } from "../../_lib/types.ts";

const Q = z.object({ id: AppId, country: Country });

export const onRequestGet = api(Q, async (q, db): Promise<AppResp> => {
  const [a] = await db.select().from(apps).where(and(eq(apps.appId, q.id), eq(apps.country, q.country)));
  if (!a) throw notFound("这个国家/地区没有该 App 的数据");
  const { bundleId: _b, updatedAt: _u, ...app } = a;

  const [s] = await db.select().from(appSummaries)
    .where(and(eq(appSummaries.appId, q.id), eq(appSummaries.country, q.country)))
    .orderBy(desc(appSummaries.weekStart)).limit(1);

  // 最新一天它在哪些榜单上、排第几
  const pos = await db.execute<{ genreId: number; chartType: string; rank: number; d: string }>(sql`
    select genre_id "genreId", chart_type "chartType", array_position(app_ids, ${q.id}::bigint) rank, snapshot_date::text d
    from chart_snapshots
    where country = ${q.country}
      and snapshot_date = (select max(snapshot_date) from chart_snapshots where country = ${q.country})
      and ${q.id}::bigint = any(app_ids)
    order by rank`);

  const counts = await db.execute<{ rating: number; n: number }>(sql`
    select rating::int, count(*)::int n from reviews where app_id = ${q.id} and country = ${q.country} group by 1`);

  return {
    app: {
      ...app,
      releaseDate: app.releaseDate?.toISOString() ?? null,
      versionDate: app.versionDate?.toISOString() ?? null,
    },
    summary: s ? { weekStart: s.weekStart, summary: s.summary as AppSummary } : null,
    positions: pos.map(({ d: _d, ...p }) => p),
    positionsDate: pos[0]?.d ?? null,
    reviewCounts: Object.fromEntries(counts.map((c) => [String(c.rating), c.n])),
  };
});

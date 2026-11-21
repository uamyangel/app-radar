import { apps, appSummaries } from "@app-radar/shared";
import { and, desc, eq, sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { api, AppId, Country } from "../../_lib/api.ts";
import type { AppResp, AppSummary } from "../../_lib/types.ts";

const Q = z.object({ id: AppId, country: Country });

export const onRequestGet = api(Q, async (q, db): Promise<AppResp> => {
  // 这个 App 在哪些国家/地区有数据（切换国家时如果当前国家没有，至少能显示名字）
  const all = await db.select({ appId: apps.appId, country: apps.country, name: apps.name, developer: apps.developer, iconUrl: apps.iconUrl })
    .from(apps).where(eq(apps.appId, q.id));
  const availableIn = all.map((x) => x.country).sort();
  const [a] = await db.select().from(apps).where(and(eq(apps.appId, q.id), eq(apps.country, q.country)));
  if (!a) return { availableIn, other: all[0] ?? null, app: null, summary: null, positions: [], positionsDate: null, reviewCounts: {}, topics: [], classified30d: 0 };
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

  // 近 30 天的评论归类统计（以该 App 最新一条评论的时间为基准，避开数据延迟）
  const topics = await db.execute<{ topic: string; n: number; avgRating: number }>(sql`
    with w as (select max(reviewed_at) - interval '30 days' since from reviews where app_id = ${q.id} and country = ${q.country})
    select t topic, count(*)::int n, round(avg(rating), 2)::float8 "avgRating"
    from reviews, unnest(topics) t, w
    where app_id = ${q.id} and country = ${q.country} and reviewed_at > w.since
    group by 1 order by 2 desc`);
  const [c30] = await db.execute<{ n: number }>(sql`
    with w as (select max(reviewed_at) - interval '30 days' since from reviews where app_id = ${q.id} and country = ${q.country})
    select count(*)::int n from reviews, w where app_id = ${q.id} and country = ${q.country} and reviewed_at > w.since and classified_at is not null`);

  return {
    availableIn,
    other: null,
    app: {
      ...app,
      releaseDate: app.releaseDate?.toISOString() ?? null,
      versionDate: app.versionDate?.toISOString() ?? null,
    },
    summary: s ? { weekStart: s.weekStart, summary: s.summary as AppSummary } : null,
    positions: pos.map(({ d: _d, ...p }) => p),
    positionsDate: pos[0]?.d ?? null,
    reviewCounts: Object.fromEntries(counts.map((c) => [String(c.rating), c.n])),
    topics: [...topics],
    classified30d: c30?.n ?? 0,
  };
});

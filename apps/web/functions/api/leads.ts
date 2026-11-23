import { sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { api, Country, DateStr } from "../_lib/api.ts";
import { LEAD_TAGS, type LeadRow, type LeadsResp } from "../_lib/types.ts";

const Q = z.object({
  country: Country,
  tag: z.enum(LEAD_TAGS),
  genre: z.coerce.number().int().optional(), // 按 App 主品类筛选；不传 = 全部白名单品类
  date: DateStr.optional(),
});

/** 每种线索按最有意义的方式排序 */
const ORDER: Record<(typeof LEAD_TAGS)[number], ReturnType<typeof sql>> = {
  陈旧在榜: sql`s.best_rank, s.days_since_update desc`,
  付费利基: sql`s.best_rank, s.rating_count`,
  口碑差: sql`(s.genre_review_median - s.review_avg_90d) desc, s.best_rank`,
  口碑下滑: sql`(s.review_avg_prev - s.review_avg_30d) desc, s.best_rank`,
  新品上榜: sql`s.best_rank, a.release_date desc`,
  小App快速上升: sql`s.rank_delta_7d desc, s.best_rank`,
  疑似刷分: sql`s.best_rank`,
};

/** 市场信号线索（不需要 AI）：只列白名单品类里、开发者为 major / normal 的 App */
export const onRequestGet = api(Q, async (q, db): Promise<LeadsResp> => {
  const [d] = await db.execute<{ d: string | null }>(sql`
    select max(snapshot_date)::text d from app_signals where country = ${q.country} ${q.date ? sql`and snapshot_date <= ${q.date}` : sql``}`);
  const date = d?.d ?? null;
  if (!date) return { date: null, counts: {}, rows: [] };
  const genreCond = q.genre ? sql`and a.primary_genre_id = ${q.genre}` : sql``;

  const counts = await db.execute<{ t: string; n: number }>(sql`
    select t, count(*)::int n from app_signals s join apps a using (app_id, country), unnest(s.tags) t
    where s.country = ${q.country} and s.snapshot_date = ${date} and s.in_scope ${genreCond} group by 1`);
  const rows = await db.execute<LeadRow>(sql`
    select s.app_id::float8 "appId", a.name, a.developer, s.dev_type "devType", a.icon_url "iconUrl", a.primary_genre_id "genreId",
      nullif(left(regexp_replace(split_part(btrim(a.description), chr(10), 1), '[[:space:]]+', ' ', 'g'), 90), '') snippet,
      s.best_rank "bestRank", s.best_chart "bestChart", a.rating_avg::float8 "ratingAvg", s.rating_count "ratingCount",
      s.rating_velocity::float8 "ratingVelocity", s.rank_delta_7d "rankDelta7d", s.days_since_update "daysSinceUpdate",
      s.review_n_90d "reviewN90d", s.review_avg_90d::float8 "reviewAvg90d", s.genre_review_median::float8 "genreReviewMedian",
      s.review_avg_30d::float8 "reviewAvg30d", s.review_avg_prev::float8 "reviewAvgPrev", s.suspicious, s.tags
    from app_signals s join apps a using (app_id, country)
    where s.country = ${q.country} and s.snapshot_date = ${date} and s.in_scope and ${q.tag} = any(s.tags) ${genreCond}
    order by ${ORDER[q.tag]} limit 200`);
  return { date, counts: Object.fromEntries(counts.map((c) => [c.t, c.n])), rows: [...rows] };
});

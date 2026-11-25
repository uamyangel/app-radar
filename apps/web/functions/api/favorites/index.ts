import { favorites } from "@app-radar/shared";
import { eq, sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { api, AppId, Country } from "../../_lib/api.ts";
import { feedbackDbFor, type Env } from "../../_lib/db.ts";
import type { FavoriteReviewRow, FavoriteRow, FavoritesResp } from "../../_lib/types.ts";
import { accessEmail, crossOrigin } from "../../_lib/write.ts";

/** 时间统一输出成 UTC 的 ISO 字符串，和其他接口一致（直接查出来的格式随数据库时区变） */
const iso = (col: ReturnType<typeof sql>) => sql`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

/**
 * 收藏列表：所有收藏的 App 和评论，最近收藏的在前。
 * 每个 App 的数据优先取当前国家的，当前国家没有就用收藏时的国家；名次是那个国家最新一天的最好名次。
 */
export const onRequestGet = api(z.object({ country: Country }), async (q, db): Promise<FavoritesResp> => {
  const rows = await db.execute<FavoriteRow>(sql`
    select f.app_id::float8 "appId", f.country "starredIn", f.note, ${iso(sql`f.created_at`)} "createdAt",
      a.country "dataCountry", a.name, a.developer, a.icon_url "iconUrl", a.primary_genre_id "genreId",
      a.rating_avg::float8 "ratingAvg", a.rating_count "ratingCount", ${iso(sql`a.version_date`)} "versionDate",
      s.summary->>'one_liner' "oneLiner",
      nullif(left(regexp_replace(split_part(btrim(a.description), chr(10), 1), '[[:space:]]+', ' ', 'g'), 90), '') snippet,
      r.rank "bestRank", r.genre_id "bestGenreId", r.chart_type "bestChart"
    from favorites f
    left join lateral (
      select * from apps where app_id = f.app_id
      order by (country = ${q.country}) desc, (country = f.country) desc limit 1
    ) a on true
    left join lateral (
      select summary from app_summaries where app_id = f.app_id and country = a.country order by week_start desc limit 1
    ) s on true
    left join lateral (
      select array_position(app_ids, f.app_id) rank, genre_id, chart_type from chart_snapshots
      where country = a.country and f.app_id = any(app_ids)
        and snapshot_date = (select max(snapshot_date) from chart_snapshots where country = a.country)
      order by 1 limit 1
    ) r on true
    order by f.created_at desc`);
  const reviews = await db.execute<FavoriteReviewRow>(sql`
    select f.review_id "reviewId", f.note, ${iso(sql`f.created_at`)} "createdAt",
      r.app_id::float8 "appId", r.country, a.name "appName", a.icon_url "iconUrl",
      r.rating, r.title, r.content, ${iso(sql`r.reviewed_at`)} "reviewedAt", r.lang, r.gist
    from favorite_reviews f
    join reviews r on r.review_id = f.review_id
    left join apps a on a.app_id = r.app_id and a.country = r.country
    order by f.created_at desc`);
  const [up] = await db.execute<{ n: number }>(sql`select count(*)::int n from feedback where verdict = 'up' and country = ${q.country}`);
  return { rows: [...rows], reviews: [...reviews], upNeeds: up?.n ?? 0 };
}, { cache: false });

const Body = z.object({
  appId: AppId,
  country: Country,
  starred: z.boolean(), // false = 取消收藏
  note: z.string().trim().max(500).nullish(),
});

/** 收藏 / 取消收藏 / 改备注：只接受同源请求；再次收藏不改收藏时间 */
export const onRequestPost: PagesFunction<Env> = async (c) => {
  const denied = crossOrigin(c.request);
  if (denied) return denied;
  const parsed = Body.safeParse(await c.request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const { appId, country, starred, note } = parsed.data;

  const w = feedbackDbFor(c.env);
  try {
    if (!starred) {
      await w.db.delete(favorites).where(eq(favorites.appId, appId));
      return Response.json({ ok: true, favorite: null });
    }
    const now = new Date();
    const [f] = await w.db.insert(favorites)
      .values({ appId, country, note: note || null, email: accessEmail(c.request), createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: favorites.appId, set: { note: note || null, updatedAt: now } })
      .returning();
    return Response.json({ ok: true, favorite: { country: f!.country, note: f!.note, createdAt: f!.createdAt.toISOString() } });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "保存失败" }, { status: 500 });
  } finally {
    c.waitUntil(w.close());
  }
};

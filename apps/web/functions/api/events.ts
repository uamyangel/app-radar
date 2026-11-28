import { sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { api, Country } from "../_lib/api.ts";
import type { EventQuote, EventRow, EventsResp } from "../_lib/types.ts";

const Q = z.object({
  country: Country,
  // follow 值得跟进 / watch 观察 / skip 噪声：卡片的结论；pending：还没写卡片
  view: z.enum(["follow", "watch", "skip", "pending"]).default("follow"),
});

/** 机会事件（docs/opportunity-method.md）：数据找出的新 App 起量，模型拆解成卡片 */
export const onRequestGet = api(Q, async (q, db): Promise<EventsResp> => {
  const [counts] = await db.execute<EventsResp["counts"]>(sql`
    select count(*) filter (where card->>'verdict' = 'follow')::int follow, count(*) filter (where card->>'verdict' = 'watch')::int watch,
           count(*) filter (where card->>'verdict' = 'skip')::int skip, count(*) filter (where card is null)::int pending
    from opportunity_events where country = ${q.country}`);
  const viewCond = q.view === "pending" ? sql`e.card is null` : sql`e.card->>'verdict' = ${q.view}`;
  const rows = await db.execute<Omit<EventRow, "quotes">>(sql`
    select e.id::float8 id, e.kind, e.app_id::float8 "appId", a.name, a.developer, a.icon_url "iconUrl", a.primary_genre_id "genreId",
           sc.name "sceneName", e.detected_on::text "detectedOn", e.first_metrics first, e.latest_on::text "latestOn", e.latest_metrics latest,
           e.status, e.checks, e.card, to_char(e.card_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') "cardAt"
    from opportunity_events e
    join apps a on a.app_id = e.app_id and a.country = e.country
    left join app_scenes x on x.app_id = e.app_id left join scenes sc on sc.id = x.scene_id
    where e.country = ${q.country} and ${viewCond}
    order by e.detected_on desc, (e.latest_metrics->>'rank')::int limit 200`);
  // 卡片引用的评论：quote_ids 可能来自这个 App，也可能来自同场景其他 App
  const ids = [...new Set(rows.flatMap((r) => r.card?.quote_ids ?? []))];
  const quotes = ids.length === 0 ? [] : await db.execute<EventQuote>(sql`
    select r.review_id id, r.app_id::float8 "appId", a.name app, r.rating::int stars, r.reviewed_at::date::text date,
           left(coalesce(r.title || '：', '') || r.content, 400) text, left(coalesce(r.title_zh || '：', '') || r.content_zh, 400) "textZh"
    from reviews r left join apps a on a.app_id = r.app_id and a.country = r.country
    where r.review_id = any(${`{${ids.join(",")}}`}::text[]) and r.country = ${q.country}`);
  const byId = new Map(quotes.map((x) => [x.id, x]));
  return {
    counts: counts ?? { follow: 0, watch: 0, skip: 0, pending: 0 },
    rows: rows.map((r) => ({ ...r, quotes: (r.card?.quote_ids ?? []).map((id) => byId.get(id)).filter((x): x is EventQuote => !!x) })),
  };
});

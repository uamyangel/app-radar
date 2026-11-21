import { sql } from "@app-radar/shared/orm";
import { TOPIC_CODES } from "@app-radar/shared/topics";
import { z } from "zod";
import { api, AppId, Country } from "../../../_lib/api.ts";
import type { Review, ReviewsResp } from "../../../_lib/types.ts";

const PAGE = 20;
const Q = z.object({
  id: AppId,
  country: Country,
  rating: z.coerce.number().int().min(1).max(5).optional(),
  sort: z.enum(["low", "recent"]).default("low"),
  topic: z.enum(TOPIC_CODES as [string, ...string[]]).optional(),
  page: z.coerce.number().int().min(0).max(1000).default(0),
});

/** 评论：默认低分优先、同分按时间倒序；可按星级和 AI 归类筛选；每页 20 条 */
export const onRequestGet = api(Q, async (q, db): Promise<ReviewsResp> => {
  const order = q.sort === "low" ? sql`rating asc, reviewed_at desc` : sql`reviewed_at desc`;
  const rows = await db.execute<Review>(sql`
    select review_id "reviewId", rating::int, title, content, author, app_version "appVersion", to_json(reviewed_at)#>>'{}' "reviewedAt", lang, topics, gist
    from reviews
    where app_id = ${q.id} and country = ${q.country} ${q.rating ? sql`and rating = ${q.rating}` : sql``}
      ${q.topic ? sql`and ${q.topic} = any(topics)` : sql``}
    order by ${order}
    limit ${PAGE + 1} offset ${q.page * PAGE}`);
  return { reviews: rows.slice(0, PAGE), hasMore: rows.length > PAGE };
});

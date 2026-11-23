import { sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { api, AppId, Country } from "../../../_lib/api.ts";
import type { NeedQuote, NeedQuotesResp } from "../../../_lib/types.ts";

const PAGE = 20;
const Q = z.object({ id: AppId, country: Country, app: AppId.optional(), page: z.coerce.number().int().min(0).max(500).default(0) });

/** 需求的全部相关评论（可按 App 筛选），表示流失/付费意愿的和低分的在前 */
export const onRequestGet = api(Q, async (q, db): Promise<NeedQuotesResp> => {
  const rows = await db.execute<NeedQuote>(sql`
    select r.review_id "reviewId", r.app_id::float8 "appId", a.name "appName", r.rating::int rating, r.title, r.content,
      to_json(r.reviewed_at)#>>'{}' "reviewedAt", r.lang, st.text statement, st.churn, st.pay, st.competitor
    from review_statements st join needs n on n.id = st.need_id
    join reviews r on r.review_id = st.review_id join apps a on a.app_id = r.app_id and a.country = r.country
    where coalesce(n.merged_into, n.id) = ${q.id} and st.country = ${q.country} ${q.app ? sql`and st.app_id = ${q.app}` : sql``}
    order by (st.churn or st.pay) desc, r.rating, r.reviewed_at desc
    limit ${PAGE + 1} offset ${q.page * PAGE}`);
  return { quotes: rows.slice(0, PAGE), hasMore: rows.length > PAGE };
});

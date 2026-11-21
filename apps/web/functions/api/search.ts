import { sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { api, Country } from "../_lib/api.ts";
import type { SearchResp } from "../_lib/types.ts";

const Q = z.object({ country: Country, q: z.string().trim().min(1).max(60) });

/** 按名称或开发者搜索（只搜采集过的 App），评分数多的排前面 */
export const onRequestGet = api(Q, async (q, db): Promise<SearchResp> => {
  const like = `%${q.q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const rows = await db.execute<SearchResp["results"][number]>(sql`
    select app_id::float8 "appId", country, name, developer, icon_url "iconUrl", rating_count "ratingCount"
    from apps
    where country = ${q.country} and (name ilike ${like} or developer ilike ${like})
    order by (name ilike ${q.q.replace(/[\\%_]/g, (c) => "\\" + c) + "%"}) desc, rating_count desc nulls last
    limit 12`);
  return { results: [...rows] };
});

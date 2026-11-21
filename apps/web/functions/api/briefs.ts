import { apps, categoryBriefs } from "@app-radar/shared";
import { and, desc, eq, inArray, lte } from "@app-radar/shared/orm";
import { z } from "zod";
import { api, Country, DateStr, Genre } from "../_lib/api.ts";
import type { Brief, BriefResp } from "../_lib/types.ts";

const Q = z.object({ country: Country, genre: Genre, week: DateStr.optional() });

/** 某品类最新（或指定周之前最近）一周的简报，附带其中提到的 App 的名称和图标 */
export const onRequestGet = api(Q, async (q, db): Promise<BriefResp> => {
  const [row] = await db.select().from(categoryBriefs)
    .where(and(eq(categoryBriefs.country, q.country), eq(categoryBriefs.genreId, q.genre),
      q.week ? lte(categoryBriefs.weekStart, q.week) : undefined))
    .orderBy(desc(categoryBriefs.weekStart)).limit(1);
  if (!row) return null;
  const brief = row.brief as Brief;
  const ids = [...new Set([...(brief.new_entries ?? []), ...(brief.movers ?? [])].map((x) => Number(x.app_id)).filter(Number.isFinite))];
  const found = ids.length
    ? await db.select({ appId: apps.appId, name: apps.name, iconUrl: apps.iconUrl }).from(apps)
        .where(and(eq(apps.country, q.country), inArray(apps.appId, ids)))
    : [];
  return { weekStart: row.weekStart, brief, apps: Object.fromEntries(found.map((a) => [String(a.appId), a])) };
});

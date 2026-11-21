import { CHART_TYPES, COUNTRIES, GENRES } from "@app-radar/shared";
import { sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { api } from "../_lib/api.ts";
import type { MetaResp } from "../_lib/types.ts";

const CHART_NAMES = { free: "免费榜", paid: "付费榜", grossing: "畅销榜" } as const;

export const onRequestGet = api(z.object({}), async (_q, db): Promise<MetaResp> => {
  const dates = await db.execute<{ d: string }>(sql`
    select distinct snapshot_date::text d from chart_snapshots order by 1 desc limit 120`);
  const runs = await db.execute<{ stage: string; status: string; finished_at: string | null }>(sql`
    select distinct on (stage) stage, status, to_json(finished_at)#>>'{}' finished_at from job_runs order by stage, id desc`);
  return {
    countries: Object.entries(COUNTRIES).map(([code, v]) => ({ code, name: v.name })),
    genres: Object.entries(GENRES).map(([id, g]) => ({ id: Number(id), ...g })),
    charts: CHART_TYPES.map((code) => ({ code, name: CHART_NAMES[code] })),
    dates: dates.map((r) => r.d),
    lastRuns: runs.map((r) => ({ stage: r.stage, status: r.status, finishedAt: r.finished_at })),
  };
});

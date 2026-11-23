/**
 * 机会发现的两层过滤（docs/insights-design.md 第 4.1 节）：
 *   第一层 品类白名单：按 App 主品类判断
 *   第二层 开发者名单：platform 只抽样，brand / content 排除，major / normal 正常分析
 */
import { developers, GAMES_GENRE_ID, type Country } from "@app-radar/shared";
import { loadDevelopers, type DeveloperType } from "@app-radar/shared/config";
import { and, eq, notInArray, sql } from "@app-radar/shared/orm";
import type { Ctx } from "./context.ts";
import { log } from "./context.ts";

/** 把 config/developers.yaml 同步进 developers 表（source=manual）；文件里删掉的手工条目也从表里删掉 */
export async function syncDevelopers(ctx: Ctx): Promise<void> {
  if (!ctx.db) return;
  const list = loadDevelopers(ctx.cfg.insights.developers_file);
  const ids = [...list.keys()];
  const now = new Date();
  if (ids.length) {
    await ctx.db.insert(developers)
      .values([...list.entries()].map(([id, d]) => ({ developerId: id, name: d.name, type: d.type, source: "manual", updatedAt: now })))
      .onConflictDoUpdate({
        target: developers.developerId,
        set: { name: sql`excluded.name`, type: sql`excluded.type`, source: sql`excluded.source`, updatedAt: sql`excluded.updated_at` },
      });
  }
  await ctx.db.delete(developers).where(and(eq(developers.source, "manual"), ids.length ? notInArray(developers.developerId, ids) : undefined));
  log("insights", `开发者名单已同步：${ids.length} 条`);
}

export type AppFilter = { genre: number | null; devType: DeveloperType };
export type FilterDecision = "analyze" | "platform" | "excluded_genre" | "excluded_dev" | "game";

export function decide(f: AppFilter, includeGenres: Set<number>): FilterDecision {
  if (f.genre === GAMES_GENRE_ID) return "game";
  if (f.genre !== null && !includeGenres.has(f.genre)) return "excluded_genre";
  if (f.devType === "brand" || f.devType === "content") return "excluded_dev";
  if (f.devType === "platform") return "platform";
  return "analyze";
}

/** 查一批 App 的主品类和开发者类型（不在名单里的开发者按 normal） */
export async function appFilters(ctx: Ctx, cc: Country, appIds: number[]): Promise<Map<number, AppFilter>> {
  const out = new Map<number, AppFilter>();
  if (!ctx.db) {
    for (const id of appIds) out.set(id, { genre: ctx.mem.appGenres?.get(`${cc}:${id}`) ?? null, devType: "normal" });
    return out;
  }
  for (let i = 0; i < appIds.length; i += 5000) {
    const chunk = appIds.slice(i, i + 5000);
    const rows = await ctx.db.execute<{ app_id: number; genre: number | null; dev_type: string | null }>(sql`
      select a.app_id::float8 app_id, a.primary_genre_id genre, d.type dev_type
      from apps a left join developers d on d.developer_id = a.developer_id
      where a.country = ${cc} and a.app_id = any(${`{${chunk.join(",")}}`}::bigint[])`);
    for (const r of rows) out.set(r.app_id, { genre: r.genre, devType: (r.dev_type ?? "normal") as DeveloperType });
  }
  return out;
}

/** 长尾轮转：App 按 ID 分成 N 组，每天轮到一组（同一个 App 每 N 天采一次） */
export function onRotation(appId: number, date: string, days: number): boolean {
  const dayNo = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  return appId % days === dayNo % days;
}

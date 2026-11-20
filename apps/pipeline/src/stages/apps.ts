import { appRatingDaily, apps, chartSnapshots, type Country } from "@app-radar/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { lookupUrl, parseLookup, type AppInfo } from "../apple.ts";
import { Job, log, type Ctx } from "../context.ts";

/** 当天榜单快照（dry-run 时用内存结果） */
export async function loadSnapshots(ctx: Ctx) {
  if (!ctx.db) return ctx.mem.snapshots ?? [];
  const rows = await ctx.db
    .select({ country: chartSnapshots.country, genreId: chartSnapshots.genreId, chartType: chartSnapshots.chartType, appIds: chartSnapshots.appIds })
    .from(chartSnapshots)
    .where(and(
      eq(chartSnapshots.snapshotDate, ctx.date),
      inArray(chartSnapshots.country, ctx.countries),
      inArray(chartSnapshots.genreId, ctx.genres),
      inArray(chartSnapshots.chartType, ctx.charts),
    ));
  return rows as { country: Country; genreId: number; chartType: (typeof ctx.charts)[number]; appIds: number[] }[];
}

/**
 * App 详情阶段：当天出现在榜单里的所有 App，按国家批量 lookup，
 * upsert apps（first_seen 只在首次插入时写），并写当天的评分快照。
 */
export async function runApps(ctx: Ctx) {
  const job = await new Job(ctx, "apps").start();
  const snaps = await loadSnapshots(ctx);
  const s = { apps_requested: 0, apps_saved: 0, missing: 0, invalid: 0, batches_failed: 0 };
  ctx.mem.appGenres = new Map();
  if (snaps.length === 0) job.error("当天没有榜单快照，先跑 charts 阶段");

  for (const cc of ctx.countries) {
    const ids = [...new Set(snaps.filter((x) => x.country === cc).flatMap((x) => x.appIds))];
    s.apps_requested += ids.length;
    const size = ctx.cfg.lookup_batch_size;
    for (let i = 0; i < ids.length; i += size) {
      if (Date.now() > ctx.deadline) { job.error("超过时间上限，提前结束"); break; }
      const batch = ids.slice(i, i + size);
      const r = await ctx.http.get(lookupUrl(cc, batch));
      if (!r.ok) { s.batches_failed++; job.error(`${cc} lookup 批次 ${i / size} HTTP ${r.status}`); continue; }
      let parsed: { apps: AppInfo[]; invalid: number };
      try { parsed = parseLookup(r.text); } catch (e) { s.batches_failed++; job.error(`${cc} lookup 解析失败：${String(e).slice(0, 200)}`); continue; }
      s.invalid += parsed.invalid;
      s.missing += batch.length - parsed.apps.length; // 已下架等
      for (const a of parsed.apps) ctx.mem.appGenres.set(`${cc}:${a.appId}`, a.primaryGenreId);
      if (ctx.db && parsed.apps.length) await saveApps(ctx, cc, parsed.apps);
      s.apps_saved += parsed.apps.length;
    }
    log("apps", `${cc} 完成：${ids.length} 个 App`);
  }
  job.stats = s;
  return job.finish(s.apps_saved === 0 && s.apps_requested > 0 ? "failed" : undefined);
}

async function saveApps(ctx: Ctx, cc: Country, list: AppInfo[]) {
  const db = ctx.db!;
  const now = new Date();
  const rows = list.map((a) => ({ ...a, country: cc, firstSeen: ctx.date, updatedAt: now }));
  const ex = (c: string) => sql.raw(`excluded.${c}`);
  await db
    .insert(apps)
    .values(rows)
    .onConflictDoUpdate({
      target: [apps.appId, apps.country],
      set: {
        name: ex("name"), developer: ex("developer"), developerId: ex("developer_id"),
        primaryGenreId: ex("primary_genre_id"), genreIds: ex("genre_ids"), price: ex("price"), currency: ex("currency"),
        ratingAvg: ex("rating_avg"), ratingCount: ex("rating_count"), version: ex("version"),
        releaseDate: ex("release_date"), versionDate: ex("version_date"), releaseNotes: ex("release_notes"),
        description: ex("description"), iconUrl: ex("icon_url"), storeUrl: ex("store_url"), bundleId: ex("bundle_id"),
        updatedAt: ex("updated_at"),
      },
    });
  await db
    .insert(appRatingDaily)
    .values(list.map((a) => ({ appId: a.appId, country: cc, snapshotDate: ctx.date, ratingAvg: a.ratingAvg, ratingCount: a.ratingCount })))
    .onConflictDoUpdate({
      target: [appRatingDaily.appId, appRatingDaily.country, appRatingDaily.snapshotDate],
      set: { ratingAvg: ex("rating_avg"), ratingCount: ex("rating_count") },
    });
}

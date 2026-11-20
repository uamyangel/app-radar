import { apps, detectLang, GAMES_GENRE_ID, GENRES, reviewCrawlState, reviews, type Country } from "@app-radar/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  parseRssReviews, parseWebReviews, rssReviewsUrl, WEB_HEADERS, webReviewsUrl, type ReviewItem,
} from "../apple.ts";
import { Job, log, type Ctx } from "../context.ts";
import { loadSnapshots } from "./apps.ts";

type Task = { cc: Country; appId: number; backfill: boolean };
type Stats = {
  apps_in_scope: number; games_skipped: number; apps_done: number; backfill_tasks: number;
  web_requests: number; web_retries: number; web_failed_apps: number; stopped_at_known: number; hit_page_cap: number;
  rss_fallback_apps: number; rss_fallback_nonempty: number; web_dup_items: number;
  reviews_fetched: number; reviews_new: number; reviews_updated: number; stopped_by_deadline: boolean;
};

/**
 * 评论阶段。
 * 范围：总榜和核心品类前 top_n_core、次要品类前 top_n_secondary（去重），排除游戏。
 * 来源：apps.apple.com 网页接口按时间倒序翻页，遇到已入库的评论就停（增量）；
 *       网页接口失败时用 RSS 兜底（RSS 实测大面积返回空数据，见 docs/m0-report.md）。
 * 回填：App 首次进入范围时最多翻 backfill_pages 页，每个国家每天最多 backfill_daily_cap 个。
 */
export async function runReviews(ctx: Ctx) {
  const job = await new Job(ctx, "reviews").start();
  const rc = ctx.cfg.reviews;
  const s: Stats = {
    apps_in_scope: 0, games_skipped: 0, apps_done: 0, backfill_tasks: 0,
    web_requests: 0, web_retries: 0, web_failed_apps: 0, stopped_at_known: 0, hit_page_cap: 0,
    rss_fallback_apps: 0, rss_fallback_nonempty: 0, web_dup_items: 0,
    reviews_fetched: 0, reviews_new: 0, reviews_updated: 0, stopped_by_deadline: false,
  };
  ctx.http.setHostInterval("apps.apple.com", rc.web_min_interval_ms);

  const all = await buildTasks(ctx, s, job);
  const tasks = ctx.limitApps ? all.slice(0, ctx.limitApps) : all;
  s.apps_in_scope = tasks.length;
  s.backfill_tasks = tasks.filter((t) => t.backfill).length;
  log("reviews", `范围内 ${tasks.length} 个 App（已排除游戏 ${s.games_skipped} 个），其中回填 ${s.backfill_tasks} 个`);

  for (const [i, t] of tasks.entries()) {
    if (Date.now() > ctx.deadline) { s.stopped_by_deadline = true; break; }
    let items = await fetchWeb(ctx, t, s, job);
    let source: "web" | "rss" = "web";
    if (items === null) {
      s.web_failed_apps++;
      items = rc.rss_fallback ? await fetchRss(ctx, t, s, job) : [];
      source = "rss";
    }
    s.reviews_fetched += items.length;
    const r = await saveReviews(ctx, t, items, source);
    s.reviews_new += r.inserted;
    s.reviews_updated += r.updated;
    await markCrawled(ctx, t, source, items.length);
    s.apps_done++;
    if ((i + 1) % 100 === 0) {
      log("reviews", `进度 ${i + 1}/${tasks.length}，新评论 ${s.reviews_new}，网页请求 ${s.web_requests}（重试 ${s.web_retries}），失败 ${s.web_failed_apps}`);
    }
  }

  job.stats = s;
  if (s.stopped_by_deadline) job.error(`超过时间上限，${tasks.length - s.apps_done} 个 App 未处理`);
  // 网页接口大面积失败时明确告警（可能被限流或接口变更）
  if (s.apps_done >= 20 && s.web_failed_apps / s.apps_done > 0.3) {
    job.error(`WEB_REVIEWS_DEGRADED：网页评论接口 ${s.web_failed_apps}/${s.apps_done} 个 App 失败`);
  }
  return job.finish();
}

/** 网页接口：翻页直到遇到已入库的评论、没有下一页或达到页数上限。请求失败返回 null */
async function fetchWeb(ctx: Ctx, t: Task, s: Stats, job: Job): Promise<ReviewItem[] | null> {
  const rc = ctx.cfg.reviews;
  // dry-run 没有库可查已有评论，按稳态（每天 1 页）估算
  const maxPages = !ctx.db ? 1 : t.backfill ? Math.max(rc.backfill_pages, rc.max_pages_per_day) : rc.max_pages_per_day;
  const out: ReviewItem[] = [];
  const seen = new Set<string>();
  for (let p = 0; p < maxPages; p++) {
    s.web_requests++;
    const r = await ctx.http.get(webReviewsUrl(t.cc, t.appId, p * 20), { headers: WEB_HEADERS, maxRetries: 3 });
    s.web_retries += r.attempts - 1; // 重试几乎都是 429
    if (!r.ok) {
      job.error(`${t.cc}/${t.appId} 网页评论 p${p} HTTP ${r.status}`);
      return p === 0 ? null : out; // 第一页就失败才算失败；后面的页失败保留已拿到的
    }
    let page: { items: ReviewItem[]; hasNext: boolean };
    try { page = parseWebReviews(r.text); } catch (e) {
      job.error(`${t.cc}/${t.appId} 网页评论解析失败：${String(e).slice(0, 200)}`);
      return p === 0 ? null : out;
    }
    // 本地测试见过翻页返回重复条目，统计出来观察；入库时会按 ID 去重
    for (const x of page.items) { if (seen.has(x.reviewId)) s.web_dup_items++; else seen.add(x.reviewId); }
    out.push(...page.items);
    if (!page.hasNext || page.items.length === 0) return out;
    if (await anyKnown(ctx, page.items.map((x) => x.reviewId))) { s.stopped_at_known++; return out; }
  }
  if (maxPages > 1) s.hit_page_cap++;
  return out;
}

/** RSS 兜底：每页空不空是随机的（CDN 缓存），所以不因为某页为空就停 */
async function fetchRss(ctx: Ctx, t: Task, s: Stats, job: Job): Promise<ReviewItem[]> {
  s.rss_fallback_apps++;
  const out: ReviewItem[] = [];
  for (let p = 1; p <= 3; p++) {
    const r = await ctx.http.get(rssReviewsUrl(t.cc, t.appId, p));
    if (!r.ok) { job.error(`${t.cc}/${t.appId} RSS p${p} HTTP ${r.status}`); continue; }
    try { out.push(...parseRssReviews(r.text)); } catch (e) { job.error(`${t.cc}/${t.appId} RSS 解析失败：${String(e).slice(0, 200)}`); }
  }
  if (out.length) s.rss_fallback_nonempty++;
  return out;
}

async function anyKnown(ctx: Ctx, ids: string[]): Promise<boolean> {
  if (!ctx.db || ids.length === 0) return false;
  const r = await ctx.db.select({ id: reviews.reviewId }).from(reviews).where(inArray(reviews.reviewId, ids)).limit(1);
  return r.length > 0;
}

async function buildTasks(ctx: Ctx, s: Stats, job: Job): Promise<Task[]> {
  const rc = ctx.cfg.reviews;
  const snaps = await loadSnapshots(ctx);
  if (snaps.length === 0) job.error("当天没有榜单快照，先跑 charts 阶段");
  const tasks: Task[] = [];

  for (const cc of ctx.countries) {
    // 按排名优先：先放各榜靠前的 App，时间不够时被截掉的是排名靠后的
    const ranked = new Map<number, number>(); // appId -> 最好名次
    for (const x of snaps.filter((x) => x.country === cc)) {
      const n = GENRES[x.genreId]?.tier === "secondary" ? rc.top_n_secondary : rc.top_n_core;
      x.appIds.slice(0, n).forEach((id, rank) => ranked.set(id, Math.min(rank, ranked.get(id) ?? Infinity)));
    }
    const list = [...ranked.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    if (list.length === 0) continue;

    const genreOf = new Map<number, number | null>();
    const backfilled = new Set<number>();
    if (ctx.db) {
      for (let i = 0; i < list.length; i += 5000) {
        const chunk = list.slice(i, i + 5000);
        const g = await ctx.db.select({ id: apps.appId, genre: apps.primaryGenreId }).from(apps)
          .where(and(eq(apps.country, cc), inArray(apps.appId, chunk)));
        for (const r of g) genreOf.set(r.id, r.genre);
        const st = await ctx.db.select({ id: reviewCrawlState.appId }).from(reviewCrawlState)
          .where(and(eq(reviewCrawlState.country, cc), inArray(reviewCrawlState.appId, chunk), sql`${reviewCrawlState.backfilledAt} is not null`));
        for (const r of st) backfilled.add(r.id);
      }
    } else {
      for (const id of list) genreOf.set(id, ctx.mem.appGenres?.get(`${cc}:${id}`) ?? null);
    }

    let budget = rc.backfill_daily_cap;
    for (const appId of list) {
      if (genreOf.get(appId) === GAMES_GENRE_ID) { s.games_skipped++; continue; }
      const backfill = ctx.db !== null && !backfilled.has(appId) && budget > 0;
      if (backfill) budget--;
      tasks.push({ cc, appId, backfill });
    }
  }
  return tasks;
}

/** 按 review_id 去重入库。已存在且内容被修改过的，更新内容并清空译文（等待重新翻译） */
async function saveReviews(ctx: Ctx, t: Task, items: ReviewItem[], source: "rss" | "web") {
  if (!ctx.db || items.length === 0) return { inserted: 0, updated: 0 };
  const seen = new Set<string>();
  const now = new Date();
  const rows = items
    .filter((x) => (seen.has(x.reviewId) ? false : (seen.add(x.reviewId), true)))
    .map((x) => ({ ...x, appId: t.appId, country: t.cc, source, fetchedAt: now, lang: detectLang(`${x.title ?? ""} ${x.content}`) }));
  const res = await ctx.db
    .insert(reviews)
    .values(rows)
    .onConflictDoUpdate({
      target: reviews.reviewId,
      set: {
        rating: sql`excluded.rating`, title: sql`excluded.title`, content: sql`excluded.content`,
        lang: sql`excluded.lang`, reviewedAt: sql`excluded.reviewed_at`,
        // 网页来源没有版本号和有用数，不要用空值覆盖 RSS 拿到的
        appVersion: sql`coalesce(excluded.app_version, ${reviews.appVersion})`,
        titleZh: sql`null`, contentZh: sql`null`, translatedAt: sql`null`,
      },
      setWhere: sql`${reviews.content} is distinct from excluded.content or ${reviews.title} is distinct from excluded.title or ${reviews.rating} <> excluded.rating`,
    })
    .returning({ inserted: sql<boolean>`xmax = 0` });
  const inserted = res.filter((r) => r.inserted).length;
  return { inserted, updated: res.length - inserted };
}

async function markCrawled(ctx: Ctx, t: Task, source: string, fetched: number) {
  if (!ctx.db) return;
  const now = new Date();
  await ctx.db
    .insert(reviewCrawlState)
    .values({ appId: t.appId, country: t.cc, firstCrawledAt: now, lastCrawledAt: now, backfilledAt: t.backfill ? now : null, lastSource: source, lastFetched: fetched })
    .onConflictDoUpdate({
      target: [reviewCrawlState.appId, reviewCrawlState.country],
      set: { lastCrawledAt: now, lastSource: source, lastFetched: fetched, ...(t.backfill ? { backfilledAt: now } : {}) },
    });
}

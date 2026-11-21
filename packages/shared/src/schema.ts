import { sql } from "drizzle-orm";
import {
  bigint, bigserial, date, index, integer, jsonb, numeric, pgTable, primaryKey, smallint, text, timestamp,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const id64 = (name: string) => bigint(name, { mode: "number" }); // App Store ID < 2^53，number 安全

/** App 信息，按国家区分 */
export const apps = pgTable(
  "apps",
  {
    appId: id64("app_id").notNull(),
    country: text("country").notNull(),
    name: text("name").notNull(),
    developer: text("developer"),
    developerId: id64("developer_id"),
    primaryGenreId: integer("primary_genre_id"),
    genreIds: integer("genre_ids").array(),
    price: numeric("price", { precision: 10, scale: 2, mode: "number" }),
    currency: text("currency"),
    ratingAvg: numeric("rating_avg", { precision: 3, scale: 2, mode: "number" }),
    ratingCount: integer("rating_count"),
    version: text("version"),
    releaseDate: ts("release_date"),
    versionDate: ts("version_date"),
    releaseNotes: text("release_notes"),
    description: text("description"),
    iconUrl: text("icon_url"),
    storeUrl: text("store_url"),
    bundleId: text("bundle_id"),
    screenshotUrls: text("screenshot_urls").array(), // iPhone 截图，没有时用 iPad 的；图片由浏览器直接从 Apple CDN 加载
    firstSeen: date("first_seen").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.appId, t.country] })],
);

/** 榜单快照：一行 = 某天某国家某品类某榜单的完整排名 */
export const chartSnapshots = pgTable(
  "chart_snapshots",
  {
    snapshotDate: date("snapshot_date").notNull(),
    country: text("country").notNull(),
    genreId: integer("genre_id").notNull(), // 0 = 总榜
    chartType: text("chart_type").notNull(), // free / paid / grossing
    appIds: bigint("app_ids", { mode: "number" }).array().notNull(), // 按排名顺序
    source: text("source").notNull(), // legacy / marketing
    fetchedAt: ts("fetched_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.snapshotDate, t.country, t.genreId, t.chartType] })],
);

export const appRatingDaily = pgTable(
  "app_rating_daily",
  {
    appId: id64("app_id").notNull(),
    country: text("country").notNull(),
    snapshotDate: date("snapshot_date").notNull(),
    ratingAvg: numeric("rating_avg", { precision: 3, scale: 2, mode: "number" }),
    ratingCount: integer("rating_count"),
  },
  (t) => [primaryKey({ columns: [t.appId, t.country, t.snapshotDate] })],
);

export const reviews = pgTable(
  "reviews",
  {
    reviewId: text("review_id").primaryKey(),
    appId: id64("app_id").notNull(),
    country: text("country").notNull(),
    rating: smallint("rating").notNull(),
    title: text("title"),
    content: text("content").notNull(),
    author: text("author"),
    appVersion: text("app_version"), // web 来源没有版本
    voteSum: integer("vote_sum"),
    voteCount: integer("vote_count"),
    reviewedAt: ts("reviewed_at").notNull(),
    source: text("source").notNull(), // rss / web
    lang: text("lang"), // 本地规则检测：zh / ja / other / unknown
    titleZh: text("title_zh"),
    contentZh: text("content_zh"),
    translatedAt: ts("translated_at"),
    fetchedAt: ts("fetched_at").notNull(),
  },
  (t) => [
    index("reviews_app_time_idx").on(t.appId, t.country, t.reviewedAt.desc()),
    index("reviews_country_rating_idx").on(t.country, t.rating),
    index("reviews_untranslated_idx").on(t.fetchedAt).where(sql`translated_at is null and lang <> 'zh'`),
  ],
);

/** 每个 App 的评论采集状态：判断是否需要回填、记录来源可用性 */
export const reviewCrawlState = pgTable(
  "review_crawl_state",
  {
    appId: id64("app_id").notNull(),
    country: text("country").notNull(),
    firstCrawledAt: ts("first_crawled_at").notNull(),
    lastCrawledAt: ts("last_crawled_at").notNull(),
    backfilledAt: ts("backfilled_at"), // 为空 = 还没回填
    lastSource: text("last_source"),
    lastFetched: integer("last_fetched"),
  },
  (t) => [primaryKey({ columns: [t.appId, t.country] })],
);

export const appSummaries = pgTable(
  "app_summaries",
  {
    appId: id64("app_id").notNull(),
    country: text("country").notNull(),
    weekStart: date("week_start").notNull(),
    summary: jsonb("summary").notNull(),
    model: text("model").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.appId, t.country, t.weekStart] })],
);

export const categoryBriefs = pgTable(
  "category_briefs",
  {
    country: text("country").notNull(),
    genreId: integer("genre_id").notNull(),
    weekStart: date("week_start").notNull(),
    brief: jsonb("brief").notNull(),
    model: text("model").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.country, t.genreId, t.weekStart] })],
);

export const jobRuns = pgTable("job_runs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  startedAt: ts("started_at").notNull(),
  finishedAt: ts("finished_at"),
  stage: text("stage").notNull(),
  status: text("status").notNull(), // running / ok / partial / failed
  stats: jsonb("stats"),
  errors: jsonb("errors"),
});

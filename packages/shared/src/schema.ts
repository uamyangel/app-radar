import { sql } from "drizzle-orm";
import {
  bigint, bigserial, boolean, date, index, integer, jsonb, numeric, pgTable, primaryKey, smallint, text, timestamp,
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
    // AI 归类：1–2 个 TOPICS 里的标签；1–3 星的评论另有一句中文要点
    topics: text("topics").array(),
    gist: text("gist"),
    classifiedAt: ts("classified_at"),
    fetchedAt: ts("fetched_at").notNull(),
  },
  (t) => [
    index("reviews_app_time_idx").on(t.appId, t.country, t.reviewedAt.desc()),
    index("reviews_country_rating_idx").on(t.country, t.rating),
    index("reviews_unclassified_idx").on(t.country, t.reviewedAt.desc()).where(sql`classified_at is null`),
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

/** 开发者分类：从 config/developers.yaml 同步（source=manual），之后 AI 补充（source=ai），manual 优先 */
export const developers = pgTable("developers", {
  developerId: id64("developer_id").primaryKey(),
  name: text("name"),
  type: text("type").notNull(), // platform / brand / content / major / normal
  source: text("source").notNull(), // manual / ai
  updatedAt: ts("updated_at").notNull(),
});

/** 每天每个在榜 App 的市场信号（不需要 AI），用于「线索」页和榜单标签 */
export const appSignals = pgTable(
  "app_signals",
  {
    appId: id64("app_id").notNull(),
    country: text("country").notNull(),
    snapshotDate: date("snapshot_date").notNull(),
    devType: text("dev_type").notNull(),
    inScope: boolean("in_scope").notNull(), // 品类在白名单内，且开发者是 major / normal
    bestRank: integer("best_rank"),
    bestChart: text("best_chart"), // 例如 "6007:paid"
    onPaid: boolean("on_paid").notNull(),
    onGrossing: boolean("on_grossing").notNull(),
    daysSinceUpdate: integer("days_since_update"),
    ratingCount: integer("rating_count"),
    ratingVelocity: numeric("rating_velocity", { precision: 12, scale: 2, mode: "number" }), // 每天新增评分数
    rankDelta7d: integer("rank_delta_7d"), // 最好名次比 7 天内最早一天上升了多少（正数=上升）
    reviewN90d: integer("review_n_90d"),
    reviewAvg90d: numeric("review_avg_90d", { precision: 3, scale: 2, mode: "number" }),
    lowShare90d: numeric("low_share_90d", { precision: 4, scale: 3, mode: "number" }),
    genreReviewMedian: numeric("genre_review_median", { precision: 3, scale: 2, mode: "number" }),
    reviewAvg30d: numeric("review_avg_30d", { precision: 3, scale: 2, mode: "number" }),
    reviewAvgPrev: numeric("review_avg_prev", { precision: 3, scale: 2, mode: "number" }), // 31–90 天前
    suspicious: text("suspicious").array(), // 疑似刷分的原因
    tags: text("tags").array().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.appId, t.country, t.snapshotDate] }),
    index("app_signals_date_idx").on(t.snapshotDate, t.country),
  ],
);

// ───────── 机会发现（docs/insights-design.md 第 1、5 节）─────────

/** 每条评论是否已做过 AI 提取（只要有一行就不再重复处理，除非显式 --redo） */
export const reviewExtractions = pgTable(
  "review_extractions",
  {
    reviewId: text("review_id").primaryKey(),
    appId: id64("app_id").notNull(),
    country: text("country").notNull(),
    genreId: integer("genre_id"),
    status: text("status").notNull(), // ok：有提法；empty：没有具体诉求；irrelevant：与 App 无关；skipped：模型反复漏掉
    statementsN: integer("statements_n").notNull(),
    promptVersion: text("prompt_version").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    extractedAt: ts("extracted_at").notNull(),
  },
  (t) => [index("review_extractions_app_idx").on(t.appId, t.country)],
);

/** 提法：一条评论里的一个具体诉求，统一转写为简体中文短句 */
export const reviewStatements = pgTable(
  "review_statements",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    reviewId: text("review_id").notNull(),
    appId: id64("app_id").notNull(),
    country: text("country").notNull(),
    genreId: integer("genre_id").notNull(),
    rating: smallint("rating").notNull(),
    reviewedAt: ts("reviewed_at").notNull(),
    text: text("text").notNull(),
    kind: text("kind").notNull(),
    churn: boolean("churn").notNull(), // 表示要卸载、换掉、求替代
    pay: boolean("pay").notNull(), // 表示愿意付费、买断
    competitor: text("competitor"), // 提到的替代品名称
    needId: id64("need_id"), // 0 = 太空泛，归不进任何具体需求（不参与统计）
    assignedAt: ts("assigned_at"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    index("review_statements_unassigned_idx").on(t.genreId).where(sql`need_id is null`),
    index("review_statements_need_idx").on(t.needId, t.country),
    index("review_statements_review_idx").on(t.reviewId),
  ],
);

/** 需求目录：按品类建、不分国家；id 一旦生成不变，合并时 merged_into 指向保留的那个 */
export const needs = pgTable(
  "needs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    genreId: integer("genre_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    kind: text("kind").notNull(),
    // 通用抱怨：任何 App 都可能被这样抱怨（太贵、广告、扣费不透明、崩溃、客服差、泛泛的功能少）。
    // 不出机会卡片，作为品类的「共性痛点」背景展示
    generic: boolean("generic").notNull().default(false),
    // 新设备 / 新系统适配：由现有 App 自己补上的事，降权、不进主列表（规则见 insights/generic.ts isAdaptation）
    adaptation: boolean("adaptation").notNull().default(false),
    object: text("object"), // 需求针对的具体对象（模型给出）；为空或是泛词则判为通用抱怨
    retired: boolean("retired").notNull().default(false), // 大杂烩需求撤销后为 true，提法重新归并
    mergedInto: id64("merged_into"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [index("needs_genre_idx").on(t.genreId)],
);

/** 每个需求在每个国家的指标（程序计算，可随时重算） */
export const needMetrics = pgTable(
  "need_metrics",
  {
    needId: id64("need_id").notNull(),
    country: text("country").notNull(),
    computedOn: date("computed_on").notNull(),
    mentions: integer("mentions").notNull(), // 提到它的不同评论数
    apps: integer("apps").notNull(),
    developers: integer("developers").notNull(),
    weeksActive: integer("weeks_active").notNull(), // 近 12 周里有几周被提到
    churnN: integer("churn_n").notNull(),
    payN: integer("pay_n").notNull(),
    oneStarShare: numeric("one_star_share", { precision: 4, scale: 3, mode: "number" }),
    prevalenceLb: numeric("prevalence_lb", { precision: 4, scale: 3, mode: "number" }), // 承载 App 中浓度的 Wilson 下界最大值
    bestHostRank: integer("best_host_rank"),
    hostOnGrossing: boolean("host_on_grossing").notNull(),
    hostStale: boolean("host_stale").notNull(),
    hostWeak: boolean("host_weak").notNull(),
    allHostsMajor: boolean("all_hosts_major").notNull(),
    evidence: numeric("evidence", { precision: 4, scale: 3, mode: "number" }).notNull(),
    market: numeric("market", { precision: 4, scale: 3, mode: "number" }).notNull(),
    gap: numeric("gap", { precision: 4, scale: 3, mode: "number" }).notNull(),
    feasibility: numeric("feasibility", { precision: 4, scale: 3, mode: "number" }).notNull(),
    score: numeric("score", { precision: 6, scale: 4, mode: "number" }).notNull(),
    tier: text("tier").notNull(), // main：上主列表；watch：待观察（含降权的新设备适配类）；generic：通用抱怨（只作背景）
    hostApps: jsonb("host_apps").notNull(), // [{appId, mentions, analyzed, bestRank, stale, reviewAvg}]
  },
  (t) => [primaryKey({ columns: [t.needId, t.country] }), index("need_metrics_rank_idx").on(t.country, t.tier, t.score)],
);

/** 机会卡片（AI 撰写）：证据变化明显时才重写 */
export const opportunityCards = pgTable(
  "opportunity_cards",
  {
    needId: id64("need_id").notNull(),
    country: text("country").notNull(),
    card: jsonb("card").notNull(),
    evidenceMentions: integer("evidence_mentions").notNull(), // 写卡片时的提及数，用来判断要不要重写
    promptVersion: text("prompt_version").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.needId, t.country] })],
);

/**
 * 你对机会的反馈（网站上标「有价值 / 没价值」）。网站用单独的账号写入，这个账号只能读写这一张表。
 * metrics_snapshot 记下标注时的四个分项，用来分析哪个分项和你的判断最相关，据此调整权重。
 */
export const feedback = pgTable(
  "feedback",
  {
    needId: id64("need_id").notNull(),
    country: text("country").notNull(),
    verdict: text("verdict").notNull(), // up：有价值；down：没价值
    note: text("note"),
    metricsSnapshot: jsonb("metrics_snapshot"),
    email: text("email"), // Cloudflare Access 登录邮箱
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.needId, t.country] })],
);

/**
 * 你收藏的 App（网站上点「收藏」），用于以后只看这些。同一个 App 在各国是同一个，按 app_id 收藏；
 * country 记下收藏时看的是哪个国家的数据。和 feedback 一样由网站的写入账号读写。
 */
export const favorites = pgTable("favorites", {
  appId: id64("app_id").primaryKey(),
  country: text("country").notNull(),
  note: text("note"),
  email: text("email"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

/** 你收藏的评论（App 详情页的评论、需求页的原话），作为证据留着回看 */
export const favoriteReviews = pgTable("favorite_reviews", {
  reviewId: text("review_id").primaryKey(),
  note: text("note"),
  email: text("email"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

/**
 * 看过的卡片：在屏幕上停留 5 秒以上，或点开了详情。手机和电脑共用。
 * kind：need（机会，key = 需求id:国家）、lead（线索，key = AppID:国家）、quote（需求页原话，key = 评论 id）。
 * ver：看的时候的版本（机会卡片的生成时间），卡片重写后版本不同，显示为「有更新」。
 */
export const seen = pgTable(
  "seen",
  {
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    ver: text("ver"),
    seenAt: ts("seen_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.key] })],
);

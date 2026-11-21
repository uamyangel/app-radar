/** API 响应类型，前端以 type-only 方式引用 */

export type MetaResp = {
  countries: { code: string; name: string }[];
  genres: { id: number; zh: string; en: string; tier: "all" | "core" | "secondary" }[];
  charts: { code: "free" | "paid" | "grossing"; name: string }[];
  dates: string[]; // 倒序
  lastRuns: { stage: string; status: string; finishedAt: string | null }[];
};

export type ChartRow = {
  rank: number;
  appId: number;
  name: string | null;
  developer: string | null;
  iconUrl: string | null;
  price: number | null;
  currency: string | null;
  ratingAvg: number | null;
  ratingCount: number | null;
  prevRank: number | null; // 昨天
  rank7d: number | null; // 7 天前
  worst7d: number | null; // 过去 7 天内最差名次；null = 过去 7 天没上过这个榜
  oneLiner: string | null;
  snippet: string | null; // 描述的第一句；AI 一句话简介生成前先用它让人知道是什么 App
};
export type ChartsResp = { date: string | null; historyDays: number; rows: ChartRow[] };

export type BriefApp = { appId: number; name: string | null; iconUrl: string | null };
export type Brief = {
  headline: string;
  new_entries: { app_id: number; note: string }[];
  movers: { app_id: number; direction: "up" | "down"; note: string }[];
  pain_points: { theme: string; description: string; frequency: string; example_review_ids: string[] }[];
  opportunities: { signal: string; reasoning: string }[];
};
export type BriefResp = { weekStart: string; brief: Brief; apps: Record<string, BriefApp> } | null;

export type AppSummary = {
  one_liner: string;
  positioning: string;
  loved: string[];
  complaints: { theme: string; share: string; example_review_ids: string[] }[];
  rating_trend: string;
  notable_changes: string;
  opportunity_hint: string;
};
export type AppBasic = { appId: number; country: string; name: string; developer: string | null; iconUrl: string | null };
export type AppResp = {
  /** 这个国家/地区有没有该 App 的数据；没有时用 other 显示名字，并列出有数据的国家 */
  availableIn: string[];
  other: AppBasic | null;
  app: null | {
    appId: number; country: string; name: string; developer: string | null; developerId: number | null;
    primaryGenreId: number | null; genreIds: number[] | null; price: number | null; currency: string | null;
    ratingAvg: number | null; ratingCount: number | null; version: string | null;
    releaseDate: string | null; versionDate: string | null; releaseNotes: string | null; description: string | null;
    iconUrl: string | null; storeUrl: string | null; firstSeen: string; screenshotUrls: string[] | null;
  };
  summary: { weekStart: string; summary: AppSummary } | null;
  positions: { genreId: number; chartType: string; rank: number }[];
  positionsDate: string | null;
  reviewCounts: Record<string, number>; // "1".."5" -> 条数
  /** 近 30 天评论的 AI 归类统计（一条评论可以有 1–2 个标签） */
  topics: { topic: string; n: number; avgRating: number }[];
  classified30d: number;
};

export type RanksResp = {
  series: { genreId: number; chartType: string; points: { date: string; rank: number }[] }[];
  ratings: { date: string; ratingAvg: number | null; ratingCount: number | null }[];
};

export type Review = {
  reviewId: string; rating: number; title: string | null; content: string; author: string | null;
  appVersion: string | null; reviewedAt: string; lang: string | null;
  topics: string[] | null; gist: string | null;
};
export type ReviewsResp = { reviews: Review[]; hasMore: boolean };

export type SearchResp = { results: (AppBasic & { ratingCount: number | null })[] };

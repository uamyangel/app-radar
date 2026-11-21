/** Apple 各接口的 URL 和 zod 解析。只做"请求什么、怎么解析"，不碰数据库。 */
import { z } from "zod";
import type { ChartType, Country } from "@app-radar/shared";

const label = z.object({ label: z.string() });
/** RSS 的 entry 在只有一条时是对象，多条时是数组 */
const oneOrMany = <T extends z.ZodTypeAny>(s: T) =>
  z.union([z.array(s), s]).optional().transform((x) => (x === undefined ? [] : Array.isArray(x) ? x : [x]));

// ---------- 榜单：旧版 iTunes RSS ----------
const LEGACY_SLUG: Record<ChartType, string> = {
  free: "topfreeapplications",
  paid: "toppaidapplications",
  grossing: "topgrossingapplications",
};
export const legacyChartUrl = (cc: Country, genre: number, chart: ChartType, limit: number) =>
  `https://itunes.apple.com/${cc}/rss/${LEGACY_SLUG[chart]}/limit=${limit}${genre ? `/genre=${genre}` : ""}/json`;

const LegacyEntry = z.object({
  id: z.object({ attributes: z.object({ "im:id": z.string().regex(/^\d+$/) }) }),
  category: z.object({ attributes: z.object({ "im:id": z.string() }) }).optional(),
});
const LegacyFeed = z.object({ feed: z.object({ entry: oneOrMany(LegacyEntry) }) });

export type ChartEntry = { appId: number; genreId: number | null };
export function parseLegacyChart(text: string): ChartEntry[] {
  return LegacyFeed.parse(JSON.parse(text)).feed.entry.map((e) => ({
    appId: Number(e.id.attributes["im:id"]),
    genreId: e.category ? Number(e.category.attributes["im:id"]) : null,
  }));
}

// ---------- 榜单：新版 Marketing Tools RSS（只有总榜免费/付费）----------
export const MARKETING_CHARTS: Partial<Record<ChartType, string>> = { free: "top-free", paid: "top-paid" };
export const marketingChartUrl = (cc: Country, chart: ChartType, limit: number) =>
  `https://rss.marketingtools.apple.com/api/v2/${cc}/apps/${MARKETING_CHARTS[chart]}/${limit}/apps.json`;

const MarketingFeed = z.object({
  feed: z.object({
    results: z.array(z.object({ id: z.string().regex(/^\d+$/), genres: z.array(z.object({ genreId: z.string() })).optional() })),
  }),
});
export function parseMarketingChart(text: string): ChartEntry[] {
  return MarketingFeed.parse(JSON.parse(text)).feed.results.map((r) => ({
    appId: Number(r.id),
    genreId: r.genres?.[0] ? Number(r.genres[0].genreId) : null,
  }));
}

// ---------- App 详情：lookup ----------
export const lookupUrl = (cc: Country, ids: number[]) =>
  `https://itunes.apple.com/lookup?id=${ids.join(",")}&country=${cc}`;

const LookupResult = z.object({
  wrapperType: z.string().optional(),
  trackId: z.number(),
  trackName: z.string(),
  artistName: z.string().optional(),
  artistId: z.number().optional(),
  primaryGenreId: z.number().optional(),
  genreIds: z.array(z.string()).optional(),
  price: z.number().optional(),
  currency: z.string().optional(),
  averageUserRating: z.number().optional(),
  userRatingCount: z.number().optional(),
  version: z.string().optional(),
  releaseDate: z.string().optional(),
  currentVersionReleaseDate: z.string().optional(),
  releaseNotes: z.string().optional(),
  description: z.string().optional(),
  artworkUrl512: z.string().optional(),
  artworkUrl100: z.string().optional(),
  trackViewUrl: z.string().optional(),
  bundleId: z.string().optional(),
  screenshotUrls: z.array(z.string()).optional(),
  ipadScreenshotUrls: z.array(z.string()).optional(),
});
const LookupResponse = z.object({ results: z.array(z.unknown()) });

export type AppInfo = {
  appId: number; name: string; developer: string | null; developerId: number | null;
  primaryGenreId: number | null; genreIds: number[]; price: number | null; currency: string | null;
  ratingAvg: number | null; ratingCount: number | null; version: string | null;
  releaseDate: Date | null; versionDate: Date | null; releaseNotes: string | null; description: string | null;
  iconUrl: string | null; storeUrl: string | null; bundleId: string | null; screenshotUrls: string[];
};
const toDate = (s?: string) => (s ? new Date(s) : null);
const stripQuery = (u?: string) => (u ? u.replace(/\?uo=\d+$/, "") : null);

/** 返回解析成功的 App 和解析失败的条数（单条失败不影响整体） */
export function parseLookup(text: string): { apps: AppInfo[]; invalid: number } {
  const { results } = LookupResponse.parse(JSON.parse(text));
  const apps: AppInfo[] = [];
  let invalid = 0;
  for (const raw of results) {
    const r = LookupResult.safeParse(raw);
    if (!r.success) { invalid++; continue; }
    const x = r.data;
    if (x.wrapperType && x.wrapperType !== "software") continue;
    apps.push({
      appId: x.trackId, name: x.trackName, developer: x.artistName ?? null, developerId: x.artistId ?? null,
      primaryGenreId: x.primaryGenreId ?? null, genreIds: (x.genreIds ?? []).map(Number).filter(Number.isFinite),
      price: x.price ?? null, currency: x.currency ?? null,
      ratingAvg: x.averageUserRating !== undefined ? Math.round(x.averageUserRating * 100) / 100 : null,
      ratingCount: x.userRatingCount ?? null, version: x.version ?? null,
      releaseDate: toDate(x.releaseDate), versionDate: toDate(x.currentVersionReleaseDate),
      releaseNotes: x.releaseNotes ?? null, description: x.description ?? null,
      iconUrl: x.artworkUrl512 ?? x.artworkUrl100 ?? null, storeUrl: stripQuery(x.trackViewUrl), bundleId: x.bundleId ?? null,
      screenshotUrls: (x.screenshotUrls?.length ? x.screenshotUrls : x.ipadScreenshotUrls ?? []).slice(0, 10),
    });
  }
  return { apps, invalid };
}

// ---------- 评论 ----------
export type ReviewItem = {
  reviewId: string; rating: number; title: string | null; content: string; author: string | null;
  appVersion: string | null; voteSum: number | null; voteCount: number | null; reviewedAt: Date;
};

export const rssReviewsUrl = (cc: Country, appId: number, page: number) =>
  `https://itunes.apple.com/${cc}/rss/customerreviews/page=${page}/id=${appId}/sortby=mostrecent/json`;

const RssReview = z.object({
  id: label,
  "im:rating": label,
  title: label.optional(),
  content: label,
  author: z.object({ name: label }).optional(),
  "im:version": label.optional(),
  "im:voteSum": label.optional(),
  "im:voteCount": label.optional(),
  updated: label,
});
const RssReviewFeed = z.object({ feed: z.object({ entry: oneOrMany(z.unknown()) }) });
const int = (s?: { label: string }) => (s && /^-?\d+$/.test(s.label) ? Number(s.label) : null);

/** 没有 im:rating 的条目（可能是 App 自身信息）直接跳过 */
export function parseRssReviews(text: string): ReviewItem[] {
  const out: ReviewItem[] = [];
  for (const raw of RssReviewFeed.parse(JSON.parse(text)).feed.entry) {
    const r = RssReview.safeParse(raw);
    if (!r.success) continue;
    const e = r.data;
    out.push({
      reviewId: e.id.label, rating: Number(e["im:rating"].label), title: e.title?.label || null,
      content: e.content.label, author: e.author?.name.label || null, appVersion: e["im:version"]?.label || null,
      voteSum: int(e["im:voteSum"]), voteCount: int(e["im:voteCount"]), reviewedAt: new Date(e.updated.label),
    });
  }
  return out;
}

/** apps.apple.com 网页版走的代理接口：无需 token，每页最多 20 条，限流严格 */
export const WEB_LANG: Record<Country, string> = { us: "en-US", cn: "zh-Hans-CN", jp: "ja-JP" };
export const webReviewsUrl = (cc: Country, appId: number, offset: number) =>
  `https://apps.apple.com/api/apps/v1/catalog/${cc}/apps/${appId}/reviews?l=${WEB_LANG[cc]}&sort=recent&limit=20&offset=${offset}&platform=web&additionalPlatforms=appletv,ipad,iphone,mac`;
export const WEB_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
};

const WebReviews = z.object({
  next: z.string().optional(),
  data: z.array(
    z.object({
      id: z.string(),
      attributes: z.object({
        date: z.string(), rating: z.number().int(), title: z.string().optional(),
        review: z.string(), userName: z.string().optional(),
      }),
    }),
  ),
});
export function parseWebReviews(text: string): { items: ReviewItem[]; hasNext: boolean } {
  const d = WebReviews.parse(JSON.parse(text));
  return {
    hasNext: Boolean(d.next),
    items: d.data.map((x) => ({
      reviewId: x.id, rating: x.attributes.rating, title: x.attributes.title || null, content: x.attributes.review,
      author: x.attributes.userName || null, appVersion: null, voteSum: null, voteCount: null,
      reviewedAt: new Date(x.attributes.date),
    })),
  };
}

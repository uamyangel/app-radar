/** 配置加载（仅 Node 使用：依赖 fs） */
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { CHART_TYPES, COUNTRY_CODES, GENRES } from "./constants.ts";

export const ConfigSchema = z.object({
  countries: z.array(z.enum(COUNTRY_CODES as [string, ...string[]])).min(1),
  genres: z
    .array(z.number().int())
    .min(1)
    .refine((gs) => gs.every((g) => g in GENRES), "genres 里有未知的 genre id"),
  charts: z.array(z.enum(CHART_TYPES)).min(1),
  chart_limit: z.number().int().min(1).max(200),
  reviews: z.object({
    top_n_core: z.number().int().min(0), // 总榜 + 核心品类
    top_n_secondary: z.number().int().min(0), // 次要品类
    // 主来源：apps.apple.com 网页接口，每页 20 条，按时间倒序翻页，遇到已入库的评论就停
    max_pages_per_day: z.number().int().min(1).max(50),
    backfill_pages: z.number().int().min(0).max(50), // App 首次进入范围时最多翻几页
    backfill_daily_cap: z.number().int().min(0), // 每天最多回填多少个 App（每个国家）
    web_min_interval_ms: z.number().int().min(1000),
    rss_fallback: z.boolean(), // 网页接口失败时改用 RSS（SPEC 3.3 原接口）
  }),
  http: z.object({
    requests_per_second: z.number().positive().max(10),
    max_retries: z.number().int().min(0).max(10),
    timeout_ms: z.number().int().positive().default(30_000),
  }),
  lookup_batch_size: z.number().int().min(1).max(200),
  llm: z.object({
    provider: z.literal("deepseek"),
    model: z.string().min(1),
    daily_budget_cny: z.number().nonnegative(),
  }),
  flags: z.object({
    low_rating_threshold: z.number(),
    low_rating_max_rank: z.number().int(),
    surge_rank_delta: z.number().int(),
  }),
});
export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(path = "config.yaml"): Config {
  const raw = parse(readFileSync(path, "utf8"));
  const r = ConfigSchema.safeParse(raw);
  if (!r.success) {
    throw new Error(`config.yaml 校验失败：\n${z.prettifyError(r.error)}`);
  }
  return r.data;
}

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
    daily_budget_cny: z.number().nonnegative(), // 当天累计估算费用到这里就停，剩下的留到第二天
    usd_cny: z.number().positive(), // 估算费用用的汇率
    concurrency: z.number().int().min(1).max(32),
    // 每百万 token 的美元价格（官方页面，高峰时段）；非高峰时段乘 offpeak_factor
    pricing: z.object({
      input_cache_hit: z.number().nonnegative(),
      input_cache_miss: z.number().nonnegative(),
      output: z.number().nonnegative(),
      offpeak_factor: z.number().positive().max(1),
    }),
    classify_batch_size: z.number().int().min(1).max(100),
    summary_min_reviews: z.number().int().min(1), // 近 30 天评论少于这个数的 App 不生成摘要（信息太少）
  }),
  // 机会发现（docs/insights-design.md）：第一层品类白名单、第二层开发者名单，以及市场信号的阈值
  insights: z.object({
    include_genres: z.array(z.number().int()).min(1),
    developers_file: z.string(),
    long_tail_rotation_days: z.number().int().min(1).max(30), // 榜单靠后的 App 多少天轮到一次评论采集
    signals: z.object({
      stale_days: z.number().int().positive(), // 超过多少天没更新算陈旧
      stale_max_rank: z.number().int().positive(),
      paid_niche_max_ratings: z.number().int().positive(),
      paid_niche_max_rank: z.number().int().positive(), // 畅销榜名次上限
      rising_max_rank: z.number().int().positive(), // 快速上升后至少要排进前多少
      rising_max_ratings: z.number().int().positive(),
      rising_rank_delta: z.number().int().positive(),
      new_release_days: z.number().int().positive(),
      new_release_max_rank: z.number().int().positive(),
      weak_min_reviews: z.number().int().positive(), // 判断口碑差至少要多少条文字评论
      weak_below_median: z.number().positive(), // 文字评论均分比同品类中位数低多少算口碑差
      decline_min_reviews: z.number().int().positive(),
      decline_drop: z.number().positive(), // 近 30 天均分比之前低多少算口碑下滑
      keep_days: z.number().int().positive(), // app_signals 保留多少天
    }),
    // 每个订阅、每一步默认用的模型（命令行 --model / --model-<步骤> 可覆盖）；依据见 DECISIONS.md 的模型基准
    default_models: z.record(z.string(), z.object({ extract: z.string(), assign: z.string(), cards: z.string() }).partial()).default({}),
    // 定时自动运行（pnpm insights auto，由 launchd 每 30 分钟触发）
    auto: z.object({
      provider: z.enum(["claude", "cursor", "codex"]),
      max_calls: z.number().int().positive(), // 每次自动运行最多调用多少次
      concurrency: z.number().int().min(1).max(8),
      min_battery: z.number().int().min(0).max(100), // 没插电源时，电量低于这个百分比不跑
    }),
    // 本地 AI 流水线（pnpm insights）
    pipeline: z.object({
      window_days: z.number().int().positive(), // 分析近多少天的评论
      extract_batch: z.number().int().min(5).max(200), // 每次调用提取多少条评论
      assign_batch: z.number().int().min(10).max(500), // 每次调用归并多少条提法
      request_pattern: z.string(), // 4–5 星评论里命中这些词才分析（正则，不区分大小写）
      main_min_mentions: z.number().int().positive(), // 上主列表：至少多少条评论
      main_min_apps: z.number().int().positive(), //            并且至少多少个 App
      main_single_app_mentions: z.number().int().positive(), // 或者单个 App 至少多少条
      main_single_app_prevalence: z.number().min(0).max(1), //   且浓度下界至少多少
      // 新设备 / 新系统适配类（平台空白里由现有 App 自己补上的事）：命中 pattern 且不命中 except；排序分乘 weight，最多进待观察
      adaptation: z.object({ pattern: z.string(), except: z.string(), weight: z.number().min(0).max(1) }),
      cards_per_genre: z.number().int().positive(), // 每个国家 × 品类最多写几张卡片
      card_rewrite_growth: z.number().positive(), // 提及数增长超过这个比例才重写卡片
      feasibility_by_kind: z.record(z.string(), z.number().min(0).max(1)), // 各类诉求的可做性
    }),
    // 机会事件（docs/opportunity-method.md）：新 App 起量
    events: z.object({
      max_age_days: z.number().int().positive(), // 上架不超过多少天
      min_age_days: z.number().int().positive(), // 上架太短的不看（继承旧版评分的重新上架、首发冲量）
      min_ratings: z.number().int().positive(),
      min_recent_ratio: z.number().min(0), // 近 7 天日均增速 / 上架以来日均增速，低于这个说明已经停涨
      top_per_country: z.number().int().positive(), // 每个国家按日均增速取前多少个
      check_days: z.array(z.number().int().positive()), // 触发后第几天复核
      held_ratio: z.number().positive(), // 复核时：触发以来的日均增速 ≥ 触发时日均增速 × 这个比例，算还在涨
    }),
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

export const DEVELOPER_TYPES = ["platform", "brand", "content", "major", "normal"] as const;
export type DeveloperType = (typeof DEVELOPER_TYPES)[number];

/** 读开发者名单：{ 类型: { 开发者ID: 名称 } } → Map<开发者ID, {类型, 名称}> */
export function loadDevelopers(path: string): Map<number, { type: DeveloperType; name: string }> {
  const raw = (parse(readFileSync(path, "utf8")) ?? {}) as Record<string, Record<string, string> | null>;
  const out = new Map<number, { type: DeveloperType; name: string }>();
  for (const [type, devs] of Object.entries(raw)) {
    if (!(DEVELOPER_TYPES as readonly string[]).includes(type)) throw new Error(`${path}：未知的开发者类型 ${type}`);
    for (const [id, name] of Object.entries(devs ?? {})) {
      const n = Number(id);
      if (!Number.isSafeInteger(n)) throw new Error(`${path}：开发者 ID 不是整数：${id}`);
      if (out.has(n)) throw new Error(`${path}：开发者 ${id}（${name}）出现在多个分组里`);
      out.set(n, { type: type as DeveloperType, name: String(name) });
    }
  }
  return out;
}

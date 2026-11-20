export const COUNTRIES = {
  us: { name: "美国", needsTranslation: true },
  cn: { name: "中国", needsTranslation: false },
  jp: { name: "日本", needsTranslation: true },
} as const;
export type Country = keyof typeof COUNTRIES;
export const COUNTRY_CODES = Object.keys(COUNTRIES) as Country[];

export type GenreTier = "all" | "core" | "secondary";
export const GENRES: Record<number, { zh: string; en: string; tier: GenreTier }> = {
  0: { zh: "全部", en: "All", tier: "all" },
  6007: { zh: "效率", en: "Productivity", tier: "core" },
  6000: { zh: "商务", en: "Business", tier: "core" },
  6017: { zh: "教育", en: "Education", tier: "core" },
  6013: { zh: "健康健美", en: "Health & Fitness", tier: "core" },
  6020: { zh: "医疗", en: "Medical", tier: "core" },
  6015: { zh: "财务", en: "Finance", tier: "core" },
  6002: { zh: "工具", en: "Utilities", tier: "core" },
  6027: { zh: "图形和设计", en: "Graphics & Design", tier: "core" },
  6008: { zh: "摄影与录像", en: "Photo & Video", tier: "core" },
  6012: { zh: "生活", en: "Lifestyle", tier: "core" },
  6026: { zh: "开发者工具", en: "Developer Tools", tier: "core" },
  6006: { zh: "参考资料", en: "Reference", tier: "core" },
  6023: { zh: "美食佳饮", en: "Food & Drink", tier: "secondary" },
  6003: { zh: "旅游", en: "Travel", tier: "secondary" },
  6024: { zh: "购物", en: "Shopping", tier: "secondary" },
  6005: { zh: "社交", en: "Social Networking", tier: "secondary" },
  6009: { zh: "新闻", en: "News", tier: "secondary" },
  6018: { zh: "图书", en: "Books", tier: "secondary" },
  6011: { zh: "音乐", en: "Music", tier: "secondary" },
  6016: { zh: "娱乐", en: "Entertainment", tier: "secondary" },
};
export const GAMES_GENRE_ID = 6014;

export const CHART_TYPES = ["free", "paid", "grossing"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** 快照日期按北京时间计算（任务在北京时间凌晨运行） */
export const SNAPSHOT_TZ = "Asia/Shanghai";
export function todayInTz(tz = SNAPSHOT_TZ, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

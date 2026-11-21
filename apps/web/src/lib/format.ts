import { flags } from "virtual:app-config";
import type { ChartRow } from "../../functions/_lib/types.ts";

const compact = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
export const fmtCount = (n: number | null) => (n === null ? "–" : compact.format(n));

export function fmtPrice(price: number | null, currency: string | null) {
  if (price === null) return "–";
  if (price === 0) return "免费";
  try {
    return new Intl.NumberFormat("zh-CN", { style: "currency", currency: currency ?? "USD" }).format(price);
  } catch {
    return `${price} ${currency ?? ""}`;
  }
}

export const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "–");

export type Tags = { isNew: boolean; surge: boolean; lowHigh: boolean };

/** 标签阈值来自 config.yaml（构建时注入） */
export function tagsOf(r: ChartRow, historyDays: number): Tags {
  return {
    isNew: historyDays > 0 && r.worst7d === null,
    surge: r.worst7d !== null && r.worst7d - r.rank >= flags.surge_rank_delta,
    lowHigh: r.ratingAvg !== null && r.ratingAvg < flags.low_rating_threshold && r.rank <= flags.low_rating_max_rank,
  };
}

export const TAG_INFO = {
  new: { icon: "🆕", label: "新上榜", hint: "过去 7 天没进过这个榜" },
  surge: { icon: "🚀", label: "急升", hint: `比 7 天内最差名次上升 ≥ ${flags.surge_rank_delta} 名` },
  lowhigh: { icon: "⚠️", label: "低分高排名", hint: `评分 < ${flags.low_rating_threshold} 且排名 ≤ ${flags.low_rating_max_rank}` },
} as const;

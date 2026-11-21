import { GENRES, type Country } from "@app-radar/shared";
import type { Ctx } from "../context.ts";
import { loadSnapshots } from "./apps.ts";

/**
 * 评论、摘要共用的 App 范围：总榜和核心品类取前 top_n_core，次要品类取前 top_n_secondary。
 * 返回 appId -> 在各榜里的最好名次（从 0 开始），按名次排好序；游戏由调用方排除。
 */
export async function rankedScope(ctx: Ctx): Promise<Map<Country, [number, number][]>> {
  const rc = ctx.cfg.reviews;
  const snaps = await loadSnapshots(ctx);
  const out = new Map<Country, [number, number][]>();
  for (const cc of ctx.countries) {
    const best = new Map<number, number>();
    for (const x of snaps.filter((x) => x.country === cc)) {
      const n = GENRES[x.genreId]?.tier === "secondary" ? rc.top_n_secondary : rc.top_n_core;
      x.appIds.slice(0, n).forEach((id, rank) => best.set(id, Math.min(rank, best.get(id) ?? Infinity)));
    }
    out.set(cc, [...best.entries()].sort((a, b) => a[1] - b[1]));
  }
  return out;
}

/** 本周一（北京时间）的日期，作为周度 AI 内容的 week_start */
export function weekStartOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 周一 = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** drizzle 会把 JS 数组展开成多个参数；整数 ID 数组改用 Postgres 数组字面量，作为单个参数传入（配合 ::bigint[]） */
export function pgIntArray(ids: number[]): string {
  if (!ids.every(Number.isSafeInteger)) throw new Error("pgIntArray 只接受整数");
  return `{${ids.join(",")}}`;
}

import { signals as g } from "virtual:app-config";

/** 每种线索的含义（阈值来自 config.yaml），线索页和榜单标签共用 */
export const LEAD_INFO: Record<string, { short: string; desc: string }> = {
  陈旧在榜: { short: "陈旧", desc: `超过 ${g.stale_days} 天没更新，仍在某个榜单前 ${g.stale_max_rank}：需求还在，开发者不管了` },
  付费利基: { short: "付费利基", desc: `畅销榜前 ${g.paid_niche_max_rank}，评分数不到 ${g.paid_niche_max_ratings}：用户不多但在赚钱` },
  口碑差: { short: "口碑差", desc: `近 90 天文字评论均分比同品类中位数低 ${g.weak_below_median} 分以上（至少 ${g.weak_min_reviews} 条）` },
  口碑下滑: { short: "下滑", desc: `近 30 天文字评论均分比 31–90 天前低 ${g.decline_drop} 分以上：用户可能在找替代品` },
  新品上榜: { short: "新品", desc: `首发不到 ${g.new_release_days} 天就进了前 ${g.new_release_max_rank}：这个细分市场还没被锁死` },
  小App快速上升: { short: "快速上升", desc: `评分数不到 ${g.rising_max_ratings}，7 天内最好名次上升 ≥ ${g.rising_rank_delta} 名，现在排进前 ${g.rising_max_rank}` },
  疑似刷分: { short: "疑似刷分", desc: "评分数单日暴涨但名次没动，或短时间内出现多条完全相同的五星长评；它的名次和评分不可全信" },
  大公司: { short: "大公司", desc: "开发者是大公司（在 config/developers.yaml 里标为 major）" },
};

export const DEV_TYPE_LABEL: Record<string, string> = { major: "大公司", normal: "", platform: "平台", brand: "品牌", content: "内容" };

/** 「6007:paid」→「效率·付费榜」 */
export function chartLabel(best: string | null, genreName: (id: number) => string): string {
  if (!best) return "";
  const [g, c] = best.split(":");
  return `${genreName(Number(g))}·${{ free: "免费榜", paid: "付费榜", grossing: "畅销榜" }[c as "free"] ?? c}`;
}

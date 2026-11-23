import type { NeedMetricsRow } from "../../functions/_lib/types.ts";

/** 四个分项：数值 0–1，显示为横条 + 强/中/弱文字（不只靠颜色） */
export const PARTS = [
  { key: "evidence", label: "证据", hint: "多少人提、几个 App、持续几周、在承载 App 里的浓度" },
  { key: "market", label: "市场", hint: "承载 App 的最好名次，是否在畅销榜" },
  { key: "gap", label: "缺口", hint: "承载 App 是否停更、口碑差，用户是否在流失、愿意付费" },
  { key: "feasibility", label: "可行", hint: "诉求类型个人能不能接；对手全是大公司时略降" },
] as const;

export const tierText = (v: number) => (v >= 0.7 ? "强" : v >= 0.4 ? "中" : "弱");

export function Meter({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs" title={`${label}：${hint}（${value.toFixed(2)}）`}>
      <span className="w-6 shrink-0 text-ink-3">{label}</span>
      <span className="h-1.5 w-14 rounded-full bg-surface-2">
        <span className="block h-1.5 rounded-full" style={{ width: `${Math.max(4, value * 100)}%`, background: "var(--s1)" }} />
      </span>
      <span className={value >= 0.7 ? "text-ink" : value >= 0.4 ? "text-ink-2" : "text-ink-3"}>{tierText(value)}</span>
    </div>
  );
}

export function Meters({ m }: { m: NeedMetricsRow }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
      {PARTS.map((p) => <Meter key={p.key} label={p.label} value={m[p.key]} hint={p.hint} />)}
    </div>
  );
}

/** 关键数字：每个数字都带含义，浓度是统计下界 */
export function KeyNumbers({ m }: { m: NeedMetricsRow }) {
  const items = [
    `${m.mentions} 条评论`,
    `${m.apps} 个 App`,
    `持续 ${m.weeksActive} 周`,
    m.prevalenceLb !== null && m.prevalenceLb > 0 ? `浓度 ≥${Math.round(m.prevalenceLb * 100)}%` : null,
    m.churnN ? `${m.churnN} 人想换掉` : null,
    m.payN ? `${m.payN} 人愿付费` : null,
    m.bestHostRank ? `承载 App 最好 #${m.bestHostRank}` : null,
    m.hostStale ? "有承载 App 已停更" : null,
    m.hostWeak ? "有承载 App 口碑差" : null,
  ].filter(Boolean);
  return <div className="tabular flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-2">{items.map((t) => <span key={t}>{t}</span>)}</div>;
}

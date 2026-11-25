import type { SeenState } from "../lib/seen.ts";

/** 没看过：蓝点；看过但卡片后来重写了：「有更新」；看过：不显示 */
export function SeenMark({ state }: { state: SeenState | null | undefined }) {
  if (state === "unseen") return <span title="没看过" aria-label="没看过" className="inline-block h-2 w-2 shrink-0 rounded-full bg-accent" />;
  if (state === "updated") return <span className="shrink-0 rounded bg-accent/10 px-1 text-xs text-accent">有更新</span>;
  return null;
}

/** 「只看没看过的」开关 */
export function UnseenToggle({ on, count, onChange }: { on: boolean; count: number | null; onChange: (on: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      aria-pressed={on}
      title="在屏幕上停留 5 秒以上或点开过详情的算看过（手机和电脑共用）"
      className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm ${on ? "border-accent bg-accent/10 text-accent" : "border-line text-ink-2 hover:bg-surface-2"}`}
    >
      <span className="inline-block h-2 w-2 rounded-full bg-accent" />
      只看没看过的{count !== null && <span className="tabular text-xs opacity-70">{count}</span>}
    </button>
  );
}

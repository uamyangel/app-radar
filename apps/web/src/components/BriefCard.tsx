import type { BriefResp } from "../../functions/_lib/types.ts";
import { onLinkClick } from "../lib/router.ts";
import { AppIcon, Empty } from "./bits.tsx";

const FREQ_STYLE: Record<string, string> = { 高: "text-down", 中: "text-ink", 低: "text-ink-3" };

export function BriefCard({ data, country }: { data: BriefResp; country: string }) {
  if (!data) return <Empty>本周简报还没有生成（每周一由 AI 在后台生成）</Empty>;
  const { brief, apps, weekStart } = data;
  const AppLink = ({ id, note, prefix }: { id: number; note: string; prefix?: string }) => {
    const a = apps[String(id)];
    return (
      <li className="flex items-start gap-2">
        <a href={`/app/${id}?country=${country}`} onClick={onLinkClick} className="flex shrink-0 items-center gap-1.5 font-medium hover:underline">
          <AppIcon url={a?.iconUrl ?? null} size={20} />
          {prefix}{a?.name ?? `#${id}`}
        </a>
        <span className="text-ink-2">{note}</span>
      </li>
    );
  };
  return (
    <article className="rounded-lg border border-line p-4">
      <div className="text-xs text-ink-3">品类周报 · {weekStart} 当周</div>
      <h2 className="mt-1 text-lg font-semibold leading-snug">{brief.headline}</h2>
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink-2">用户痛点</h3>
          <ul className="space-y-2 text-sm">
            {brief.pain_points.map((p, i) => (
              <li key={i}>
                <span className="font-medium">{p.theme}</span>
                <span className={`ml-1.5 text-xs ${FREQ_STYLE[p.frequency] ?? "text-ink-3"}`}>频率{p.frequency}</span>
                <div className="text-ink-2">{p.description}</div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink-2">机会</h3>
          <ul className="space-y-2 text-sm">
            {brief.opportunities.map((o, i) => (
              <li key={i}>
                <div className="font-medium">{o.signal}</div>
                <div className="text-ink-2">{o.reasoning}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {(brief.new_entries.length > 0 || brief.movers.length > 0) && (
        <details className="mt-4 border-t border-line pt-3">
          <summary className="cursor-pointer select-none text-sm font-semibold text-ink-2">
            🆕 新进榜 {brief.new_entries.length} · 🚀 排名异动 {brief.movers.length}
          </summary>
          <div className="mt-3 grid gap-5 md:grid-cols-2">
        {brief.new_entries.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-2">🆕 新进榜</h3>
            <ul className="space-y-1.5 text-sm">{brief.new_entries.map((e) => <AppLink key={e.app_id} id={e.app_id} note={e.note} />)}</ul>
          </div>
        )}
        {brief.movers.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-2">🚀 排名异动</h3>
            <ul className="space-y-1.5 text-sm">
              {brief.movers.map((m) => <AppLink key={m.app_id} id={m.app_id} note={m.note} prefix={m.direction === "up" ? "▲ " : "▼ "} />)}
            </ul>
          </div>
        )}
          </div>
        </details>
      )}
    </article>
  );
}

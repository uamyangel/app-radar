import type { ChartRow } from "../../functions/_lib/types.ts";
import { fmtCount, fmtPrice, TAG_INFO, type Tags } from "../lib/format.ts";
import { onLinkClick } from "../lib/router.ts";
import { AppIcon, Delta, Stars } from "./bits.tsx";

type Row = ChartRow & { tags: Tags };

export function ChartTable({ rows, country, historyDays }: { rows: Row[]; country: string; historyDays: number }) {
  const hasHistory = historyDays > 0;
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-surface-2 text-left text-xs text-ink-2">
          <tr>
            <th className="w-10 px-2 py-2 text-right font-medium">#</th>
            <th className="w-12 px-2 py-2 text-right font-medium" title="相对昨天">昨天</th>
            <th className="w-12 px-2 py-2 text-right font-medium" title="相对 7 天前">7天</th>
            <th className="px-2 py-2 font-medium">App</th>
            <th className="hidden px-2 py-2 font-medium md:table-cell">开发者</th>
            <th className="px-2 py-2 text-right font-medium">评分</th>
            <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">评分数</th>
            <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">价格</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.appId} className="border-t border-line hover:bg-surface-2">
              <td className="tabular px-2 py-1.5 text-right text-ink-2">{r.rank}</td>
              <td className="px-2 py-1.5 text-right text-xs"><Delta now={r.rank} prev={r.prevRank} hasHistory={hasHistory} /></td>
              <td className="px-2 py-1.5 text-right text-xs"><Delta now={r.rank} prev={r.rank7d} hasHistory={historyDays >= 7} /></td>
              <td className="px-2 py-1.5">
                <a href={`/app/${r.appId}?country=${country}`} onClick={onLinkClick} className="flex min-w-0 items-center gap-2.5">
                  <AppIcon url={r.iconUrl} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium text-ink">{r.name ?? `#${r.appId}`}</span>
                      {r.tags.isNew && <Tag k="new" />}
                      {r.tags.surge && <Tag k="surge" />}
                      {r.tags.lowHigh && <Tag k="lowhigh" />}
                    </div>
                    {r.oneLiner && <div className="truncate text-xs text-ink-2">{r.oneLiner}</div>}
                    <div className="truncate text-xs text-ink-3 md:hidden">{r.developer}</div>
                  </div>
                </a>
              </td>
              <td className="hidden max-w-48 truncate px-2 py-1.5 text-ink-2 md:table-cell">{r.developer}</td>
              <td className="px-2 py-1.5 text-right"><Stars value={r.ratingAvg} /></td>
              <td className="tabular hidden px-2 py-1.5 text-right text-ink-2 sm:table-cell">{fmtCount(r.ratingCount)}</td>
              <td className="tabular hidden px-2 py-1.5 text-right text-ink-2 sm:table-cell">{fmtPrice(r.price, r.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tag({ k }: { k: keyof typeof TAG_INFO }) {
  const t = TAG_INFO[k];
  return (
    <span title={`${t.label}：${t.hint}`} aria-label={t.label} className="shrink-0 text-xs">
      {t.icon}
    </span>
  );
}

import type { MetaResp } from "../../functions/_lib/types.ts";
import type { Filters } from "../lib/filters.ts";
import { onLinkClick } from "../lib/router.ts";
import { filtersToSearch } from "../lib/filters.ts";
import { SearchBox } from "./SearchBox.tsx";

type Props = { meta: MetaResp; filters: Filters; onChange: (p: Partial<Filters>) => void; onApp: boolean; onLeads: boolean; page: "opps" | "leads" | "charts" | "favs" };

const sel = "h-8 rounded-md border border-line bg-surface px-2 text-sm text-ink focus:outline-2 focus:outline-accent";

export function FilterBar({ meta, filters, onChange, onApp, onLeads, page }: Props) {
  const groups = [
    { label: "全部", items: meta.genres.filter((g) => g.tier === "all") },
    { label: "核心品类", items: meta.genres.filter((g) => g.tier === "core") },
    { label: "次要品类", items: meta.genres.filter((g) => g.tier === "secondary") },
  ];
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2">
        <a href={`/${filtersToSearch({ ...filters, date: null, quick: "" })}`} onClick={onLinkClick} className="mr-1 font-semibold tracking-tight text-ink">
          App Radar
        </a>
        <nav className="mr-2 flex gap-1 text-sm" aria-label="页面">
          <a href={`/opps?country=${filters.country}`} onClick={onLinkClick} className={`rounded px-2 py-1 ${page === "opps" ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"}`}>机会</a>
          <a href={`/leads?country=${filters.country}`} onClick={onLinkClick} className={`rounded px-2 py-1 ${page === "leads" && !onApp ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"}`}>线索</a>
          <a href={`/${filtersToSearch({ ...filters, date: null, quick: "" })}`} onClick={onLinkClick} className={`rounded px-2 py-1 ${page === "charts" && !onApp ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"}`}>榜单</a>
          <a href={`/favorites?country=${filters.country}`} onClick={onLinkClick} className={`rounded px-2 py-1 ${page === "favs" ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"}`}>收藏</a>
        </nav>
        {/* 国家/地区：分段按钮，最常切换 */}
        <div className="flex overflow-hidden rounded-md border border-line" role="radiogroup" aria-label="国家/地区">
          {meta.countries.map((c) => (
            <button
              key={c.code}
              role="radio"
              aria-checked={filters.country === c.code}
              onClick={() => onChange({ country: c.code })}
              className={`h-8 px-3 text-sm ${filters.country === c.code ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"}`}
            >
              {c.name}
            </button>
          ))}
        </div>
        {page === "charts" && <>
        <select aria-label="品类" className={sel} value={filters.genre} onChange={(e) => onChange({ genre: Number(e.target.value), quick: "" })}>
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map((x) => <option key={x.id} value={x.id}>{x.zh}</option>)}
            </optgroup>
          ))}
        </select>
        <div className="flex overflow-hidden rounded-md border border-line" role="radiogroup" aria-label="榜单">
          {meta.charts.map((c) => (
            <button
              key={c.code}
              role="radio"
              aria-checked={!onApp && filters.chart === c.code}
              onClick={() => onChange({ chart: c.code, quick: "" })}
              className={`h-8 px-3 text-sm ${!onApp && filters.chart === c.code ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"}`}
            >
              {c.name}
            </button>
          ))}
        </div>
        <select aria-label="日期" className={`${sel} tabular`} value={filters.date ?? ""} onChange={(e) => onChange({ date: e.target.value || null })}>
          <option value="">最新{meta.dates[0] ? `（${meta.dates[0]}）` : ""}</option>
          {meta.dates.slice(1).map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        </>}
        <div className="w-full sm:ml-auto sm:w-auto">
          <SearchBox country={filters.country} />
        </div>
      </div>
    </header>
  );
}

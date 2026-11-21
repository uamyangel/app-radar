import { useMemo } from "react";
import type { BriefResp, ChartsResp, MetaResp } from "../../functions/_lib/types.ts";
import { BriefCard } from "../components/BriefCard.tsx";
import { ChartTable } from "../components/ChartTable.tsx";
import { Empty, ErrorBox, Section } from "../components/bits.tsx";
import { qs, useApi } from "../lib/api.ts";
import type { Filters } from "../lib/filters.ts";
import { tagsOf, TAG_INFO } from "../lib/format.ts";

type Props = { meta: MetaResp; filters: Filters; setFilters: (p: Partial<Filters>) => void };

export function CategoryPage({ meta, filters, setFilters }: Props) {
  const { country, genre, chart, date, quick } = filters;
  const charts = useApi<ChartsResp>(`/api/charts?${qs({ country, genre, chart, date })}`);
  const brief = useApi<BriefResp>(`/api/briefs?${qs({ country, genre })}`);

  const rows = useMemo(() => (charts.data?.rows ?? []).map((r) => ({ ...r, tags: tagsOf(r, charts.data!.historyDays) })), [charts.data]);
  const counts = { new: rows.filter((r) => r.tags.isNew).length, surge: rows.filter((r) => r.tags.surge).length, lowhigh: rows.filter((r) => r.tags.lowHigh).length };
  const shown = rows.filter((r) => (quick === "new" ? r.tags.isNew : quick === "surge" ? r.tags.surge : quick === "lowhigh" ? r.tags.lowHigh : true));

  const genreName = meta.genres.find((g) => g.id === genre)?.zh ?? "";
  const chartName = meta.charts.find((c) => c.code === chart)?.name ?? "";
  const countryName = meta.countries.find((c) => c.code === country)?.name ?? "";
  const chip = (active: boolean) =>
    `h-7 rounded-full border px-2.5 text-xs ${active ? "border-ink bg-ink text-surface" : "border-line text-ink-2 hover:bg-surface-2"}`;

  return (
    <main className="mx-auto max-w-6xl px-4 pb-16">
      <div className="mt-4">
        {brief.error ? <ErrorBox msg={brief.error} /> : brief.loading && !brief.data ? <div className="h-24 animate-pulse rounded-lg bg-surface-2" /> : <BriefCard data={brief.data ?? null} country={country} />}
      </div>

      <Section
        title={`${countryName} · ${genreName} · ${chartName}`}
        extra={charts.data?.date && <span className="tabular text-xs text-ink-3">{charts.data.date}{charts.data.historyDays === 0 && " · 只有一天的数据，排名变化和标签从明天开始显示"}</span>}
      >
        <div className="mb-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="快捷筛选">
          <button role="radio" aria-checked={quick === ""} className={chip(quick === "")} onClick={() => setFilters({ quick: "" })}>全部 {rows.length}</button>
          {(["new", "surge", "lowhigh"] as const).map((k) => (
            <button key={k} role="radio" aria-checked={quick === k} title={TAG_INFO[k].hint} className={chip(quick === k)} onClick={() => setFilters({ quick: quick === k ? "" : k })}>
              {TAG_INFO[k].icon} 只看{TAG_INFO[k].label} <span className="tabular">{counts[k]}</span>
            </button>
          ))}
        </div>
        {charts.error && <ErrorBox msg={charts.error} />}
        {charts.loading && !charts.data && <div className="h-96 animate-pulse rounded-lg bg-surface-2" />}
        {charts.data && (charts.data.rows.length === 0
          ? <Empty>{charts.data.date ? "Apple 这一天的这个榜单是空的" : "还没有这个榜单的数据"}</Empty>
          : shown.length === 0 ? <Empty>没有符合条件的 App</Empty>
          : <ChartTable rows={shown} country={country} historyDays={charts.data.historyDays} />)}
      </Section>
    </main>
  );
}

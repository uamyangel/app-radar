import type { FavoritesResp, MetaResp } from "../../functions/_lib/types.ts";
import { AppIcon, Empty, ErrorBox, Stars } from "../components/bits.tsx";
import { qs, useApi } from "../lib/api.ts";
import { fmtCount, fmtDate } from "../lib/format.ts";
import { onLinkClick, useScrollRestore } from "../lib/router.ts";

/** 收藏：你在详情页收藏的 App，最近收藏的在前；数据优先用当前国家的 */
export function FavoritesPage({ meta, country }: { meta: MetaResp; country: string }) {
  const res = useApi<FavoritesResp>(`/api/favorites?${qs({ country })}`);
  useScrollRestore(!!res.data);
  const genreName = (id: number | null) => meta.genres.find((g) => g.id === id)?.zh ?? "";
  const countryName = (cc: string | null) => meta.countries.find((c) => c.code === cc)?.name ?? cc ?? "";
  const chartName = (c: string | null) => meta.charts.find((x) => x.code === c)?.name ?? c ?? "";

  return (
    <main className="mx-auto max-w-4xl px-4 pb-16">
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-base font-semibold">
          收藏的 App <span className="tabular text-sm font-normal text-ink-3">{res.data?.rows.length ?? ""}</span>
        </h1>
        {res.data && res.data.upNeeds > 0 && (
          <a href={`/opps?country=${country}&fb=up`} onClick={onLinkClick} className="text-sm text-accent hover:underline">
            机会里标了「有价值」的需求 {res.data.upNeeds} 条 →
          </a>
        )}
      </div>

      {res.error ? <div className="mt-4"><ErrorBox msg={res.error} /></div>
        : !res.data ? <div className="mt-4 h-32 animate-pulse rounded-lg bg-surface-2" />
        : res.data.rows.length === 0 ? <div className="mt-4"><Empty>还没有收藏。在 App 详情页点「☆ 收藏」，就会出现在这里。</Empty></div>
        : (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {res.data.rows.map((r) => (
              <li key={r.appId}>
                <a href={`/app/${r.appId}?country=${r.dataCountry ?? r.starredIn}`} onClick={onLinkClick} className="flex gap-3 px-1 py-3 hover:bg-surface-2">
                  <AppIcon url={r.iconUrl} size={48} alt={r.name ?? ""} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium">{r.name ?? `App #${r.appId}`}</span>
                      <span className="tabular shrink-0 text-xs text-ink-3">收藏于 {fmtDate(r.createdAt)}</span>
                    </div>
                    <div className="truncate text-xs text-ink-3">
                      {[r.developer, genreName(r.genreId), r.dataCountry !== country ? `${countryName(r.dataCountry)}的数据` : null].filter(Boolean).join(" · ")}
                    </div>
                    {(r.oneLiner ?? r.snippet) && <div className="mt-0.5 line-clamp-2 text-sm text-ink-2">{r.oneLiner ?? r.snippet}</div>}
                    <div className="tabular mt-1 flex flex-wrap gap-x-3 text-xs text-ink-2">
                      <span><Stars value={r.ratingAvg} size="text-xs" /> <span className="text-ink-3">（{fmtCount(r.ratingCount)}）</span></span>
                      <span>{r.bestRank ? `${r.bestGenreId ? genreName(r.bestGenreId) : "总榜"}·${chartName(r.bestChart)} #${r.bestRank}` : "今天不在榜"}</span>
                      <span className="text-ink-3">更新于 {fmtDate(r.versionDate)}</span>
                    </div>
                    {r.note && <div className="mt-1.5 rounded-md bg-surface-2 px-2 py-1 text-sm">{r.note}</div>}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
    </main>
  );
}

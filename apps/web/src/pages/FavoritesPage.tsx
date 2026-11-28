import type { FavoriteReviewRow, FavoritesResp, MetaResp } from "../../functions/_lib/types.ts";
import { AppIcon, Empty, ErrorBox, Stars } from "../components/bits.tsx";
import { ReviewStar } from "../components/ReviewStar.tsx";
import { qs, useApi } from "../lib/api.ts";
import { fmtCount, fmtDate } from "../lib/format.ts";
import { navigate, onLinkClick, useScrollRestore } from "../lib/router.ts";

/** 收藏：App 和评论两栏，最近收藏的在前；App 的数据优先用当前国家的 */
export function FavoritesPage({ meta, country, search }: { meta: MetaResp; country: string; search: string }) {
  const res = useApi<FavoritesResp>(`/api/favorites?${qs({ country })}`);
  const tab = new URLSearchParams(search).get("tab") === "reviews" ? "reviews" : "apps";
  const tabCls = (active: boolean) => `h-8 rounded-md px-3 text-sm ${active ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"}`;
  useScrollRestore(!!res.data);
  const genreName = (id: number | null) => meta.genres.find((g) => g.id === id)?.zh ?? "";
  const countryName = (cc: string | null) => meta.countries.find((c) => c.code === cc)?.name ?? cc ?? "";
  const chartName = (c: string | null) => meta.charts.find((x) => x.code === c)?.name ?? c ?? "";

  return (
    <main className="mx-auto max-w-4xl px-4 pb-16">
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex gap-1" role="tablist" aria-label="收藏类型">
          <button role="tab" aria-selected={tab === "apps"} className={tabCls(tab === "apps")} onClick={() => navigate(`/favorites?country=${country}`, { replace: true })}>
            App <span className="tabular text-xs opacity-70">{res.data?.rows.length ?? ""}</span>
          </button>
          <button role="tab" aria-selected={tab === "reviews"} className={tabCls(tab === "reviews")} onClick={() => navigate(`/favorites?country=${country}&tab=reviews`, { replace: true })}>
            评论 <span className="tabular text-xs opacity-70">{res.data?.reviews.length ?? ""}</span>
          </button>
        </div>
        {res.data && res.data.upNeeds > 0 && (
          <a href={`/opps/needs?country=${country}&fb=up`} onClick={onLinkClick} className="text-sm text-accent hover:underline">
            机会里标了「有价值」的需求 {res.data.upNeeds} 条 →
          </a>
        )}
      </div>

      {res.error ? <div className="mt-4"><ErrorBox msg={res.error} /></div>
        : !res.data ? <div className="mt-4 h-32 animate-pulse rounded-lg bg-surface-2" />
        : tab === "reviews" ? <ReviewList rows={res.data.reviews} countryName={countryName} />
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

/** 收藏的评论：原文、所属 App、日期和备注；可以在这里取消收藏或改备注 */
function ReviewList({ rows, countryName }: { rows: FavoriteReviewRow[]; countryName: (cc: string | null) => string }) {
  if (rows.length === 0) return <div className="mt-4"><Empty>还没有收藏评论。在 App 详情页的评论或需求页的原话旁点「☆ 收藏」。</Empty></div>;
  return (
    <ul className="mt-3 divide-y divide-line border-y border-line">
      {rows.map((r) => (
        <li key={r.reviewId} className="px-1 py-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
            <a href={`/app/${r.appId}?country=${r.country}`} onClick={onLinkClick} className="flex items-center gap-1.5 font-medium text-ink hover:underline">
              <AppIcon url={r.iconUrl} size={20} />{r.appName ?? `App #${r.appId}`}
            </a>
            <span className={r.rating <= 2 ? "text-down" : "text-ink"}>{"★".repeat(r.rating)}</span>
            <span className="tabular">{fmtDate(r.reviewedAt)} · {countryName(r.country)}</span>
            <span className="tabular">收藏于 {fmtDate(r.createdAt)}</span>
          </div>
          {r.gist && <div lang="zh" className="mt-1 text-sm font-medium">→ {r.gist}</div>}
          <div lang={r.lang === "zh" ? "zh" : r.lang === "ja" ? "ja" : undefined} className="mt-0.5 text-sm text-ink-2">
            {r.title && <span className="font-medium text-ink">{r.title} </span>}{r.content}
          </div>
          <div className="mt-1.5"><ReviewStar reviewId={r.reviewId} /></div>
        </li>
      ))}
    </ul>
  );
}

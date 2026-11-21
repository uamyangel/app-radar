import { useState } from "react";
import type { AppResp, MetaResp, RanksResp } from "../../functions/_lib/types.ts";
import { LineChart, type Series } from "../components/LineChart.tsx";
import { Reviews } from "../components/Reviews.tsx";
import { AppIcon, Empty, ErrorBox, Section, Stars } from "../components/bits.tsx";
import { qs, useApi } from "../lib/api.ts";
import { fmtCount, fmtDate, fmtPrice } from "../lib/format.ts";
import { filtersToSearch } from "../lib/filters.ts";
import { onLinkClick } from "../lib/router.ts";

const SERIES_COLORS = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7", "--s8"].map((v) => `var(${v})`);

export function AppPage({ meta, appId, country }: { meta: MetaResp; appId: number; country: string }) {
  const [days, setDays] = useState(30);
  const app = useApi<AppResp>(`/api/apps/${appId}?${qs({ country })}`);
  const ranks = useApi<RanksResp>(`/api/apps/${appId}/ranks?${qs({ country, days })}`);

  const genreName = (id: number | null) => meta.genres.find((g) => g.id === id)?.zh ?? (id === 6014 ? "游戏" : String(id ?? ""));
  const chartName = (c: string) => meta.charts.find((x) => x.code === c)?.name ?? c;

  if (app.error) return <main className="mx-auto max-w-4xl px-4 py-6"><ErrorBox msg={app.error} /></main>;
  if (!app.data) return <main className="mx-auto max-w-4xl px-4 py-6"><div className="h-32 animate-pulse rounded-lg bg-surface-2" /></main>;
  const { app: a, summary, positions, positionsDate, reviewCounts } = app.data;

  // 颜色跟着榜单走（API 已按最好名次排序），8 条以内各占一个固定色位
  const rankSeries: Series[] = (ranks.data?.series ?? []).slice(0, 8).map((s, i) => ({
    key: `${s.genreId}:${s.chartType}`,
    label: `${genreName(s.genreId)}·${chartName(s.chartType)}`,
    color: SERIES_COLORS[i]!,
    points: s.points.map((p) => ({ date: p.date, value: p.rank })),
  }));
  const ratingSeries: Series[] = [{
    key: "rating", label: "平均评分", color: SERIES_COLORS[0]!,
    points: (ranks.data?.ratings ?? []).filter((r) => r.ratingAvg !== null).map((r) => ({ date: r.date, value: r.ratingAvg! })),
  }];
  const ratingVals = ratingSeries[0]!.points.map((p) => p.value);
  const tab = (active: boolean) => `h-7 rounded-md px-2 text-xs ${active ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"}`;

  return (
    <main className="mx-auto max-w-4xl px-4 pb-16">
      {/* 基本信息 */}
      <div className="mt-5 flex gap-4">
        <AppIcon url={a.iconUrl} size={72} alt={a.name} />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight">{a.name}</h1>
          <div className="mt-0.5 text-sm text-ink-2">{a.developer} · {genreName(a.primaryGenreId)}</div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span><Stars value={a.ratingAvg} /> <span className="text-ink-3">（{fmtCount(a.ratingCount)} 个评分）</span></span>
            <span className="text-ink-2">{fmtPrice(a.price, a.currency)}</span>
            <span className="text-ink-2">v{a.version} · 更新于 {fmtDate(a.versionDate)}</span>
            <span className="text-ink-3">首发 {fmtDate(a.releaseDate)}</span>
            {a.storeUrl && <a className="text-accent hover:underline" href={a.storeUrl} target="_blank" rel="noreferrer">App Store ↗</a>}
          </div>
          {positions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {positions.map((p) => (
                <a
                  key={`${p.genreId}:${p.chartType}`}
                  href={`/${filtersToSearch({ country, genre: p.genreId, chart: p.chartType as "free" })}`}
                  onClick={onLinkClick}
                  className="tabular rounded border border-line px-1.5 py-0.5 text-xs text-ink-2 hover:bg-surface-2"
                >
                  {genreName(p.genreId)}·{chartName(p.chartType)} #{p.rank}
                </a>
              ))}
              <span className="tabular self-center text-xs text-ink-3">{positionsDate}</span>
            </div>
          )}
        </div>
      </div>

      {/* AI 摘要 */}
      <Section title="AI 摘要" extra={summary && <span className="text-xs text-ink-3">{summary.weekStart} 当周</span>}>
        {summary ? (
          <div className="rounded-lg border border-line p-4 text-sm">
            <p className="font-medium">{summary.summary.one_liner}</p>
            <p className="mt-1 text-ink-2">{summary.summary.positioning}</p>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-1 font-semibold text-ink-2">用户喜欢</h3>
                <ul className="list-disc space-y-0.5 pl-4 text-ink-2">{summary.summary.loved.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
              <div>
                <h3 className="mb-1 font-semibold text-ink-2">主要抱怨</h3>
                <ul className="space-y-1 text-ink-2">{summary.summary.complaints.map((c, i) => <li key={i}><span className="text-ink">{c.theme}</span> <span className="text-xs text-ink-3">{c.share}</span></li>)}</ul>
              </div>
            </div>
            {summary.summary.rating_trend && <p className="mt-3 text-ink-2"><span className="font-semibold">评分变化：</span>{summary.summary.rating_trend}</p>}
            {summary.summary.notable_changes && <p className="mt-1 text-ink-2"><span className="font-semibold">近期变化：</span>{summary.summary.notable_changes}</p>}
            {summary.summary.opportunity_hint && <p className="mt-2 rounded-md bg-surface-2 px-3 py-2"><span className="font-semibold">机会提示：</span>{summary.summary.opportunity_hint}</p>}
          </div>
        ) : (
          <Empty>还没有生成（每周一由 AI 在后台为各榜前 50 的 App 生成）</Empty>
        )}
      </Section>

      {/* 走势 */}
      <Section
        title="排名走势"
        extra={<div className="flex gap-1">{[30, 90].map((d) => <button key={d} className={tab(days === d)} onClick={() => setDays(d)}>{d} 天</button>)}</div>}
      >
        {ranks.error ? <ErrorBox msg={ranks.error} /> : <LineChart series={rankSeries} invert format={(v) => `#${Math.round(v)}`} emptyText="这段时间没有进过任何榜单" />}
      </Section>
      <Section title="评分走势">
        {ranks.error ? null : (
          <LineChart
            series={ratingSeries}
            height={160}
            yDomain={ratingVals.length ? [Math.max(1, Math.min(...ratingVals) - 0.2), Math.min(5, Math.max(...ratingVals) + 0.2)] : undefined}
            format={(v) => v.toFixed(2)}
          />
        )}
      </Section>

      {/* 评论 */}
      <Section title="用户评论">
        <Reviews appId={appId} country={country} counts={reviewCounts} />
      </Section>

      {/* 描述 */}
      {a.description && (
        <details className="mt-6 rounded-lg border border-line px-4 py-3">
          <summary className="cursor-pointer select-none text-sm font-semibold">App 描述</summary>
          <p className="mt-2 whitespace-pre-line text-sm text-ink-2">{a.description}</p>
          {a.releaseNotes && (
            <>
              <h3 className="mt-4 text-sm font-semibold">最新版本说明</h3>
              <p className="mt-1 whitespace-pre-line text-sm text-ink-2">{a.releaseNotes}</p>
            </>
          )}
        </details>
      )}
    </main>
  );
}

import { useEffect, useState } from "react";
import type { AppResp, MetaResp, RanksResp } from "../../functions/_lib/types.ts";
import { FavoriteButton } from "../components/FavoriteButton.tsx";
import { Lightbox } from "../components/Lightbox.tsx";
import { LineChart, type Series } from "../components/LineChart.tsx";
import { Reviews } from "../components/Reviews.tsx";
import { AppIcon, DetailTop, Empty, ErrorBox, Section, Stars } from "../components/bits.tsx";
import { qs, useApi } from "../lib/api.ts";
import { fmtCount, fmtDate, fmtPrice } from "../lib/format.ts";
import { filtersToSearch } from "../lib/filters.ts";
import { goBack, navigate, onLinkClick, useScrollRestore } from "../lib/router.ts";
import { markSeen } from "../lib/seen.ts";

const SERIES_COLORS = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7", "--s8"].map((v) => `var(${v})`);

export function AppPage({ meta, appId, country, onCountry }: { meta: MetaResp; appId: number; country: string; onCountry: (cc: string) => void }) {
  const [days, setDays] = useState(30);
  const app = useApi<AppResp>(`/api/apps/${appId}?${qs({ country })}`);
  const ranks = useApi<RanksResp>(`/api/apps/${appId}/ranks?${qs({ country, days })}`);

  useScrollRestore(!!app.data);
  // 点开详情就算看过（线索列表里的这个 App）
  const hasApp = !!app.data?.app;
  useEffect(() => { if (hasApp) markSeen("lead", `${appId}:${country}`, null); }, [hasApp, appId, country]);
  const countryName = (cc: string) => meta.countries.find((c) => c.code === cc)?.name ?? cc;
  const genreName = (id: number | null) => meta.genres.find((g) => g.id === id)?.zh ?? (id === 6014 ? "游戏" : String(id ?? ""));
  const chartName = (c: string) => meta.charts.find((x) => x.code === c)?.name ?? c;

  // 有数据的国家才给切换；切国家只换当前 App 的数据，不离开详情页
  const withData = app.data?.availableIn ?? [];
  const back = (
    <DetailTop
      onBack={() => goBack(`/?country=${country}`)}
      country={country}
      countries={meta.countries.filter((c) => c.code === country || withData.includes(c.code))}
      onCountry={onCountry}
    />
  );
  if (app.error) return <main className="mx-auto max-w-4xl px-4">{back}<div className="mt-4"><ErrorBox msg={app.error} /></div></main>;
  if (!app.data) return <main className="mx-auto max-w-4xl px-4">{back}<div className="mt-5 h-32 animate-pulse rounded-lg bg-surface-2" /></main>;
  const { app: a, summary, positions, positionsDate, reviewCounts, availableIn, other, topics, classified30d } = app.data;

  // 这个国家/地区没有该 App 的数据：仍然显示它是什么，并给出有数据的国家
  if (!a) {
    return (
      <main className="mx-auto max-w-4xl px-4 pb-16">
        {back}
        <div className="mt-4 flex items-center gap-4">
          <AppIcon url={other?.iconUrl ?? null} size={72} alt={other?.name ?? ""} />
          <div>
            <h1 className="text-xl font-semibold">{other?.name ?? `App #${appId}`}</h1>
            {other?.developer && <div className="text-sm text-ink-2">{other.developer}</div>}
          </div>
        </div>
        <div className="mt-5 rounded-lg border border-line p-4 text-sm">
          <p>这个 App 没有进过{countryName(country)}的任何榜单，所以没有采集它在{countryName(country)}的数据。</p>
          {availableIn.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-ink-2">有数据的国家/地区：</span>
              {availableIn.map((cc) => (
                <button key={cc} onClick={() => navigate(`/app/${appId}?country=${cc}`, { replace: true })} className="h-8 rounded-md border border-line px-3 hover:bg-surface-2">
                  查看{countryName(cc)}
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
    );
  }

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
      {back}
      {/* 基本信息 */}
      <div className="mt-3 flex gap-4">
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
          <div className="mt-3"><FavoriteButton appId={appId} country={country} /></div>
        </div>
      </div>

      {/* 描述放在前面：先知道这个 App 是做什么的 */}
      {a.description && <Description text={a.description} releaseNotes={a.releaseNotes} />}

      {a.screenshotUrls && a.screenshotUrls.length > 0 && <Screenshots urls={a.screenshotUrls} />}

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
        <Reviews appId={appId} country={country} counts={reviewCounts} topics={topics} classified30d={classified30d} />
      </Section>
    </main>
  );
}

/** Apple CDN 的图片按 URL 里的尺寸返回：{宽}x0w 表示指定宽度、高度按比例 */
const sized = (u: string, w: number) => u.replace(/\/\d+x\d+bb\.(jpg|png)$/, `/${w}x0w.$1`);

/** 截图横向滚动；图片直接从 Apple CDN 加载（不经过我们的服务器）。点开是弹窗预览，可以左右切换；按住 ⌘/Ctrl 点仍在新标签页打开原图 */
function Screenshots({ urls }: { urls: string[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const images = urls.map((u) => ({ thumb: sized(u, 400), full: sized(u, 1290) }));
  return (
    <div className="-mx-4 mt-5 overflow-x-auto px-4">
      <div className="flex gap-3 pb-2">
        {images.map((im, i) => (
          <a
            key={im.full}
            href={im.full}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              setOpen(i);
            }}
            className="shrink-0"
          >
            <img src={im.thumb} alt="App 截图" loading="lazy" className="h-72 w-auto rounded-lg border border-line object-contain sm:h-96" />
          </a>
        ))}
      </div>
      {open !== null && <Lightbox images={images} start={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** App 描述：默认显示前几行，长的可以展开；最新版本说明放在展开后 */
function Description({ text, releaseNotes }: { text: string; releaseNotes: string | null }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 240 || text.split("\n").length > 5 || !!releaseNotes;
  return (
    <section className="mt-5">
      <h2 className="mb-1 text-base font-semibold">App 描述</h2>
      <p className={`whitespace-pre-line text-sm text-ink-2 ${open ? "" : "line-clamp-5"}`}>{text}</p>
      {open && releaseNotes && (
        <>
          <h3 className="mt-4 text-sm font-semibold">最新版本说明</h3>
          <p className="mt-1 whitespace-pre-line text-sm text-ink-2">{releaseNotes}</p>
        </>
      )}
      {long && (
        <button onClick={() => setOpen(!open)} className="mt-1 text-sm text-accent hover:underline">
          {open ? "收起" : releaseNotes ? "展开全部（含最新版本说明）" : "展开全部"}
        </button>
      )}
    </section>
  );
}

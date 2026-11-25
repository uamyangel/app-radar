import { includeGenres } from "virtual:app-config";
import type { LeadRow, LeadsResp, MetaResp } from "../../functions/_lib/types.ts";
import { LEAD_TAGS } from "../../functions/_lib/types.ts";
import { AppIcon, Empty, ErrorBox, Stars } from "../components/bits.tsx";
import { SeenMark, UnseenToggle } from "../components/SeenMark.tsx";
import { qs, useApi } from "../lib/api.ts";
import { fmtCount } from "../lib/format.ts";
import { chartLabel, DEV_TYPE_LABEL, LEAD_INFO } from "../lib/leads.ts";
import { navigate, onLinkClick, useScrollRestore } from "../lib/router.ts";
import { markSeen, type SeenState, useDwell, useSeen, useSeenItems, useUnseenSnapshot } from "../lib/seen.ts";

type Props = { meta: MetaResp; country: string; search: string };

/** 市场信号线索：不需要 AI，从榜单和评论数据直接算出来的「可能有空隙」的地方 */
export function LeadsPage({ meta, country, search }: Props) {
  const p = new URLSearchParams(search);
  const tag = (LEAD_TAGS as readonly string[]).includes(p.get("tag") ?? "") ? p.get("tag")! : "陈旧在榜";
  const genre = Number(p.get("lgenre") ?? 0) || null;
  const res = useApi<LeadsResp>(`/api/leads?${qs({ country, tag, genre })}`);
  useScrollRestore(!!res.data && !res.loading);
  // 看过的 App：没看过的标蓝点；「只看没看过的」按进页面时的状态过滤。点开详情也算看过
  const onlyUnseen = p.get("unseen") === "1";
  const seenItems = useSeenItems(res.data?.rows, (r) => ({ key: `${r.appId}:${country}`, ver: null }));
  const seen = useSeen("lead", seenItems);
  const snapshot = useUnseenSnapshot(seen.ready && !!res.data, seen.states, res.data);
  const unseenCount = seen.ready && res.data ? [...seen.states.values()].filter((x) => x !== "seen").length : null;
  const shown = onlyUnseen && snapshot ? res.data?.rows.filter((r) => snapshot.has(`${r.appId}:${country}`)) : res.data?.rows;

  const genreName = (id: number) => meta.genres.find((g) => g.id === id)?.zh ?? String(id);
  const go = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams(search);
    for (const [k, v] of Object.entries(patch)) v === null || v === "" ? next.delete(k) : next.set(k, String(v));
    next.set("country", country);
    navigate(`/leads?${next}`, { replace: true });
  };
  const tab = (active: boolean) => `h-8 rounded-md px-3 text-sm ${active ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"}`;

  return (
    <main className="mx-auto max-w-6xl px-4 pb-16">
      <div className="mt-4 flex flex-wrap items-center gap-1" role="tablist" aria-label="线索类型">
        {LEAD_TAGS.map((t) => (
          <button key={t} role="tab" aria-selected={tag === t} className={tab(tag === t)} onClick={() => go({ tag: t })}>
            {t} <span className="tabular text-xs opacity-70">{res.data?.counts[t] ?? ""}</span>
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-line" />
        <UnseenToggle on={onlyUnseen} count={unseenCount} onChange={(on) => go({ unseen: on ? "1" : null })} />
        <select
          aria-label="品类"
          className="ml-auto h-8 rounded-md border border-line bg-surface px-2 text-sm"
          value={genre ?? ""}
          onChange={(e) => go({ lgenre: e.target.value || null })}
        >
          <option value="">全部品类（白名单内）</option>
          {includeGenres.map((id) => <option key={id} value={id}>{genreName(id)}</option>)}
        </select>
      </div>
      <p className="mt-2 text-sm text-ink-2">
        {LEAD_INFO[tag]?.desc}。只列白名单品类里、开发者不属于平台、品牌和内容公司的 App。
        {res.data?.date && <span className="tabular text-ink-3"> 数据日期 {res.data.date}</span>}
      </p>

      <div className="mt-3">
        {res.error && <ErrorBox msg={res.error} />}
        {res.loading && !res.data && <div className="h-96 animate-pulse rounded-lg bg-surface-2" />}
        {res.data && (res.data.rows.length === 0 ? <Empty>没有符合条件的 App</Empty> : shown!.length === 0 ? <Empty>这一类的 App 都看过了</Empty> : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-sm">
              <thead className="whitespace-nowrap bg-surface-2 text-left text-xs text-ink-2">
                <tr>
                  <th className="px-2 py-2 font-medium">App</th>
                  <th className="px-2 py-2 font-medium">最好名次</th>
                  <th className="px-2 py-2 text-right font-medium" title="官方评分 / 近 90 天文字评论均分（条数）">评分 / 文字评论</th>
                  <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">评分数</th>
                  <th className="hidden px-2 py-2 text-right font-medium md:table-cell">没更新</th>
                  <th className="hidden px-2 py-2 font-medium lg:table-cell">标签</th>
                </tr>
              </thead>
              <tbody>
                {shown!.map((r) => <LeadItem key={r.appId} r={r} tag={tag} country={country} genreName={genreName} state={seen.states.get(`${r.appId}:${country}`) ?? null} />)}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </main>
  );
}

/** 一行线索：在屏幕上停留 5 秒算看过 */
function LeadItem({ r, tag, country, genreName, state }: { r: LeadRow; tag: string; country: string; genreName: (id: number) => string; state: SeenState | null }) {
  const ref = useDwell<HTMLTableRowElement>(() => markSeen("lead", `${r.appId}:${country}`, null), state === "unseen");
  return (
    <tr ref={ref} className="border-t border-line hover:bg-surface-2">
      <td className="px-2 py-1.5">
        <a href={`/app/${r.appId}?country=${country}`} onClick={onLinkClick} className="flex min-w-0 items-center gap-2.5">
          <AppIcon url={r.iconUrl} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5"><SeenMark state={state} /><span className="truncate font-medium text-ink">{r.name}</span></div>
            <div className="truncate text-xs text-ink-3">
              {r.developer}{DEV_TYPE_LABEL[r.devType] ? ` · ${DEV_TYPE_LABEL[r.devType]}` : ""}{r.genreId ? ` · ${genreName(r.genreId)}` : ""}
            </div>
            {r.snippet && <div className="max-w-xl truncate text-xs text-ink-3" title={r.snippet}>{r.snippet}</div>}
          </div>
        </a>
      </td>
      <td className="tabular whitespace-nowrap px-2 py-1.5 text-ink-2">
        #{r.bestRank} <span className="text-xs text-ink-3">{chartLabel(r.bestChart, genreName)}</span>
        {r.rankDelta7d ? <div className={`text-xs ${r.rankDelta7d > 0 ? "text-up" : "text-down"}`}>7 天 {r.rankDelta7d > 0 ? "▲" : "▼"}{Math.abs(r.rankDelta7d)}</div> : null}
      </td>
      <td className="tabular whitespace-nowrap px-2 py-1.5 text-right">
        <Stars value={r.ratingAvg} />
        <div className="text-xs text-ink-3">
          {r.reviewAvg90d !== null ? <>文字 <span className={r.genreReviewMedian !== null && r.reviewAvg90d < r.genreReviewMedian - 0.5 ? "text-down" : ""}>{r.reviewAvg90d.toFixed(1)}</span>（{r.reviewN90d}）</> : "无文字评论"}
        </div>
        {tag === "口碑下滑" && r.reviewAvg30d !== null && r.reviewAvgPrev !== null && (
          <div className="text-xs text-down">{r.reviewAvgPrev.toFixed(1)} → {r.reviewAvg30d.toFixed(1)}</div>
        )}
      </td>
      <td className="tabular hidden whitespace-nowrap px-2 py-1.5 text-right text-ink-2 sm:table-cell">
        {fmtCount(r.ratingCount)}
        {r.ratingVelocity !== null && r.ratingVelocity > 0 && <div className="text-xs text-ink-3">+{fmtCount(Math.round(r.ratingVelocity))}/天</div>}
      </td>
      <td className="tabular hidden whitespace-nowrap px-2 py-1.5 text-right text-ink-2 md:table-cell">
        {r.daysSinceUpdate === null ? "–" : r.daysSinceUpdate >= 365 ? `${(r.daysSinceUpdate / 365).toFixed(1)} 年` : `${r.daysSinceUpdate} 天`}
      </td>
      <td className="hidden px-2 py-1.5 lg:table-cell">
        <div className="flex flex-wrap gap-1">
          {r.tags.map((t) => (
            <span key={t} title={LEAD_INFO[t]?.desc} className={`rounded border px-1 text-xs ${t === "疑似刷分" ? "border-down/50 text-down" : "border-line text-ink-2"}`}>
              {LEAD_INFO[t]?.short ?? t}
            </span>
          ))}
        </div>
        {r.suspicious && <div className="mt-0.5 text-xs text-down">{r.suspicious.join("；")}</div>}
      </td>
    </tr>
  );
}

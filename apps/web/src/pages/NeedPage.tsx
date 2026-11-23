import { KIND_SHORT, KINDS } from "@app-radar/shared/needs";
import { useEffect, useState } from "react";
import type { MetaResp, NeedQuote, NeedQuotesResp, NeedResp } from "../../functions/_lib/types.ts";
import { AppIcon, Empty, ErrorBox, Section, Stars } from "../components/bits.tsx";
import { LineChart } from "../components/LineChart.tsx";
import { KeyNumbers, PARTS, tierText } from "../components/opp.tsx";
import { getJson, qs, useApi } from "../lib/api.ts";
import { chartLabel } from "../lib/leads.ts";
import { goBack, onLinkClick, useScrollRestore } from "../lib/router.ts";

export function NeedPage({ meta, needId, country }: { meta: MetaResp; needId: number; country: string }) {
  const res = useApi<NeedResp>(`/api/needs/${needId}?${qs({ country })}`);
  useScrollRestore(!!res.data);
  const genreName = (id: number) => meta.genres.find((g) => g.id === id)?.zh ?? String(id);
  const back = <button onClick={() => goBack(`/opps?country=${country}`)} className="mt-4 text-sm text-ink-2 hover:text-ink">← 返回</button>;
  if (res.error) return <main className="mx-auto max-w-4xl px-4">{back}<div className="mt-4"><ErrorBox msg={res.error} /></div></main>;
  if (!res.data) return <main className="mx-auto max-w-4xl px-4">{back}<div className="mt-4 h-40 animate-pulse rounded-lg bg-surface-2" /></main>;
  const { need, metrics: m, card, cardMeta, hostApps, weekly, quotes } = res.data;

  return (
    <main className="mx-auto max-w-4xl px-4 pb-16">
      {back}
      <div className="mt-3 text-xs text-ink-3">{genreName(need.genreId)} · {KIND_SHORT[need.kind] ?? need.kind}（{KINDS[need.kind as keyof typeof KINDS] ?? ""}）</div>
      <h1 className="mt-1 text-xl font-semibold leading-snug">{card?.title ?? need.title}</h1>
      {card && <div className="mt-1 text-sm text-ink-2">需求：{need.title}</div>}
      {need.description && <p className="mt-1 text-sm text-ink-3">{need.description}</p>}

      {m ? (
        <Section title="信号强弱" extra={<span className={`text-xs ${m.tier === "main" ? "text-ink-2" : "text-ink-3"}`}>{m.tier === "main" ? "主列表" : m.tier === "generic" ? "通用抱怨：只作背景，不算机会" : "待观察：证据还不够"} · 排序分 {m.score.toFixed(3)}</span>}>
          <div className="rounded-lg border border-line p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {PARTS.map((p) => (
                <div key={p.key}>
                  <div className="flex items-baseline justify-between text-sm"><span className="font-medium">{p.label}</span><span className="tabular text-ink-2">{tierText(m[p.key])} · {m[p.key].toFixed(2)}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-surface-2"><div className="h-2 rounded-full" style={{ width: `${Math.max(3, m[p.key] * 100)}%`, background: "var(--s1)" }} /></div>
                  <div className="mt-0.5 text-xs text-ink-3">{p.hint}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 border-t border-line pt-3"><KeyNumbers m={m} /></div>
          </div>
        </Section>
      ) : <div className="mt-4"><Empty>这个国家/地区还没有它的数据</Empty></div>}

      {card && (
        <Section title="机会分析" extra={cardMeta && <span className="text-xs text-ink-3">{cardMeta.provider}/{cardMeta.model} · {cardMeta.createdAt.slice(0, 10)}</span>}>
          <div className="space-y-3 rounded-lg border border-line p-4 text-sm">
            <Field k="谁有这个需求" v={card.who} />
            <Field k="遇到的问题" v={card.problem} />
            <Field k="证据" v={card.evidence} />
            <Field k="个人能不能做" v={`${card.indie_fit}（工作量：${card.complexity}）`} />
            <Field k="切入角度" v={card.angle} />
            <Field k="收费方式" v={card.monetization} />
            {card.risks.length > 0 && <div><div className="text-ink-3">风险</div><ul className="mt-0.5 list-disc pl-5 text-ink-2">{card.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
            {card.existing.length > 0 && (
              <div>
                <div className="text-ink-3">现有产品没做好的地方</div>
                <ul className="mt-0.5 space-y-0.5 text-ink-2">
                  {card.existing.map((e) => (
                    <li key={e.app_id}>
                      <a href={`/app/${e.app_id}?country=${country}`} onClick={onLinkClick} className="font-medium text-ink hover:underline">
                        {hostApps.find((h) => h.appId === e.app_id)?.name ?? `#${e.app_id}`}
                      </a>：{e.gap}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Section>
      )}

      {quotes.length > 0 && (
        <Section title="代表性原话">
          <QuoteList quotes={quotes} country={country} />
        </Section>
      )}

      <Section title="承载这个需求的 App">
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="whitespace-nowrap bg-surface-2 text-left text-xs text-ink-2">
              <tr><th className="px-2 py-2 font-medium">App</th><th className="px-2 py-2 text-right font-medium" title="提到这个需求的评论数 / 这个 App 被分析的评论数">提到 / 分析</th><th className="px-2 py-2 font-medium">最好名次</th><th className="px-2 py-2 text-right font-medium">评分 / 文字</th><th className="hidden px-2 py-2 text-right font-medium sm:table-cell">没更新</th></tr>
            </thead>
            <tbody>
              {hostApps.map((h) => (
                <tr key={h.appId} className="border-t border-line">
                  <td className="px-2 py-1.5">
                    <a href={`/app/${h.appId}?country=${country}`} onClick={onLinkClick} className="flex items-center gap-2 hover:underline">
                      <AppIcon url={h.iconUrl} size={28} /><span className="max-w-60 truncate">{h.name}</span>
                      {h.devType === "major" && <span className="text-xs text-ink-3">大公司</span>}
                    </a>
                  </td>
                  <td className="tabular px-2 py-1.5 text-right text-ink-2">{h.mentions} / {h.analyzed}</td>
                  <td className="tabular whitespace-nowrap px-2 py-1.5 text-ink-2">{h.bestRank ? `#${h.bestRank}` : "–"} <span className="text-xs text-ink-3">{chartLabel(h.bestChart, genreName)}</span></td>
                  <td className="tabular px-2 py-1.5 text-right"><Stars value={h.ratingAvg} /> <span className="text-xs text-ink-3">{h.reviewAvg?.toFixed(1) ?? "–"}</span></td>
                  <td className="tabular hidden px-2 py-1.5 text-right text-ink-2 sm:table-cell">{h.daysSinceUpdate === null ? "–" : h.daysSinceUpdate >= 365 ? `${(h.daysSinceUpdate / 365).toFixed(1)} 年` : `${h.daysSinceUpdate} 天`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {weekly.length > 0 && (
        <Section title="每周提到的评论数">
          <LineChart series={[{ key: "n", label: "评论数", color: "var(--s1)", points: weekly.map((w) => ({ date: w.week, value: w.n })) }]} height={150} format={(v) => String(Math.round(v))} />
        </Section>
      )}

      <Section title="全部相关评论">
        <AllQuotes needId={need.id} country={country} apps={hostApps.map((h) => ({ id: h.appId, name: h.name }))} />
      </Section>
    </main>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return <div><div className="text-ink-3">{k}</div><div className="mt-0.5 text-ink">{v}</div></div>;
}

function QuoteList({ quotes, country }: { quotes: NeedQuote[]; country: string }) {
  return (
    <ul className="divide-y divide-line">
      {quotes.map((q) => (
        <li key={q.reviewId} className="py-2.5">
          <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-3">
            <span className={q.rating <= 2 ? "text-down" : "text-ink"}>{"★".repeat(q.rating)}</span>
            <a href={`/app/${q.appId}?country=${country}`} onClick={onLinkClick} className="hover:underline">{q.appName}</a>
            <span className="tabular">{q.reviewedAt.slice(0, 10)}</span>
            {q.churn && <span className="text-down">想换掉</span>}
            {q.pay && <span className="text-up">愿付费</span>}
            {q.competitor && <span>提到：{q.competitor}</span>}
          </div>
          <div lang="zh" className="mt-0.5 text-sm font-medium">→ {q.statement}</div>
          <div lang={q.lang === "zh" ? "zh" : q.lang === "ja" ? "ja" : undefined} className="mt-0.5 text-sm text-ink-2">
            {q.title && <span className="font-medium text-ink">{q.title} </span>}{q.content}
          </div>
        </li>
      ))}
    </ul>
  );
}

function AllQuotes({ needId, country, apps }: { needId: number; country: string; apps: { id: number; name: string }[] }) {
  const [app, setApp] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<NeedQuote[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => { setItems([]); setPage(0); }, [needId, country, app]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    getJson<NeedQuotesResp>(`/api/needs/${needId}/quotes?${qs({ country, app, page })}`).then((r) => {
      if (!alive) return;
      setItems((xs) => (page === 0 ? r.quotes : [...xs, ...r.quotes]));
      setHasMore(r.hasMore);
      setLoading(false);
    }, () => alive && setLoading(false));
    return () => { alive = false; };
  }, [needId, country, app, page]);
  const chip = (active: boolean) => `h-7 rounded-full border px-2.5 text-xs ${active ? "border-ink bg-ink text-surface" : "border-line text-ink-2 hover:bg-surface-2"}`;
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        <button className={chip(app === null)} onClick={() => setApp(null)}>全部 App</button>
        {apps.slice(0, 8).map((a) => <button key={a.id} className={chip(app === a.id)} onClick={() => setApp(a.id)}>{a.name.slice(0, 18)}</button>)}
      </div>
      <QuoteList quotes={items} country={country} />
      {(hasMore || loading) && (
        <div className="mt-3 text-center">
          <button className="h-8 rounded-md border border-line px-4 text-sm text-ink-2 hover:bg-surface-2" disabled={loading} onClick={() => setPage((p) => p + 1)}>{loading ? "加载中…" : "加载更多"}</button>
        </div>
      )}
    </div>
  );
}

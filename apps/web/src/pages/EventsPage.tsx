import { useState } from "react";
import type { EventCheck, EventRow, EventsResp, EventVerdict, MetaResp } from "../../functions/_lib/types.ts";
import { AppIcon, Empty, ErrorBox } from "../components/bits.tsx";
import { qs, useApi } from "../lib/api.ts";
import { navigate, onLinkClick, useScrollRestore } from "../lib/router.ts";

type Props = { meta: MetaResp; country: string; search: string };
type View = EventVerdict | "pending";
const VIEWS: View[] = ["follow", "watch", "skip", "pending"];
const VIEW_TEXT: Record<View, string> = { follow: "值得跟进", watch: "观察", skip: "噪声", pending: "待分析" };
const VIEW_NOTE: Record<View, string> = {
  follow: "上架一年内、评分增速在本国新 App 里领先的产品，起量原因说得清，而且有小团队能做的切口。",
  watch: "起量是真的，但切口还说不清，或者要看能不能持续。触发后第 30、90 天会自动复核。",
  skip: "刷量或激励换评分、灰色内容、大公司或成熟品牌的新产品、继承旧版评分的重新上架。放在这里方便核对。",
  pending: "已经被数据选出、还没写卡片的事件，下次本地分析时会写。",
};
const STATUS_TEXT: Record<string, string> = { watching: "观察中", held: "复核：还在涨", faded: "复核：已停涨", skip: "" };
const CHART_TEXT: Record<string, string> = { free: "免费榜", paid: "付费榜", grossing: "畅销榜" };

/** 机会：数据先找出哪里有新 App 跑出来，再由 AI 拆解它为什么赢、我们从哪里切 */
export function EventsPage({ meta, country, search }: Props) {
  const p = new URLSearchParams(search);
  const v = p.get("view");
  const view: View = (VIEWS as string[]).includes(v ?? "") ? (v as View) : "follow";
  const res = useApi<EventsResp>(`/api/events?${qs({ country, view })}`);
  useScrollRestore(!!res.data && !res.loading);
  const genreName = (id: number) => meta.genres.find((g) => g.id === id)?.zh ?? String(id);
  const chartName = (c: string | null) => {
    if (!c) return null;
    const [g, t] = c.split(":");
    return `${Number(g) === 0 ? "总" : genreName(Number(g))}${CHART_TEXT[t ?? ""] ?? t}`;
  };
  const tab = (active: boolean) => `h-8 rounded-md px-3 text-sm ${active ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"}`;

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16">
      <div className="mt-4 flex flex-wrap items-center gap-1">
        {VIEWS.map((x) => (x === "pending" && !res.data?.counts.pending ? null : (
          <button key={x} className={tab(view === x)} onClick={() => navigate(`/opps?${qs({ country, view: x === "follow" ? null : x })}`, { replace: true })}>
            {VIEW_TEXT[x]} <span className="tabular text-xs opacity-70">{res.data?.counts[x] ?? ""}</span>
          </button>
        )))}
        <a href={`/opps/needs?country=${country}`} onClick={onLinkClick} className="ml-auto text-xs text-ink-3 hover:text-ink hover:underline">旧版：从评论需求出发的卡片</a>
      </div>
      <p className="mt-2 text-sm text-ink-2">{VIEW_NOTE[view]}</p>

      <div className="mt-4 space-y-3">
        {res.error && <ErrorBox msg={res.error} />}
        {res.loading && !res.data && <div className="h-64 animate-pulse rounded-lg bg-surface-2" />}
        {res.data && res.data.rows.length === 0 && <Empty>这一栏现在是空的</Empty>}
        {res.data?.rows.map((r) => <EventItem key={r.id} r={r} country={country} genreName={genreName} chartName={chartName} />)}
      </div>
    </main>
  );
}

function EventItem({ r, country, genreName, chartName }: { r: EventRow; country: string; genreName: (id: number) => string; chartName: (c: string | null) => string | null }) {
  const [open, setOpen] = useState(false);
  const c = r.card;
  const m = r.latest;
  const numbers = [
    `上架 ${m.age} 天`,
    `${m.ratings.toLocaleString()} 条评分`,
    `日均 +${m.per_day}`,
    m.per_day_7d !== null ? `近 7 天日均 +${m.per_day_7d}` : null,
    m.best_rank ? `${chartName(m.best_chart)}第 ${m.best_rank}` : null,
    `本国新 App 增速第 ${m.rank}`,
  ].filter(Boolean);
  const checks = Object.entries(r.checks).sort(([a], [b]) => Number(a) - Number(b));
  return (
    <div className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
        <span className="rounded bg-surface-2 px-1.5 py-0.5 font-medium text-ink-2">{r.sceneName ?? genreName(r.genreId)}</span>
        <span>新 App 起量 · {r.detectedOn} 发现</span>
        {STATUS_TEXT[r.status] && <span className={r.status === "held" ? "text-up" : r.status === "faded" ? "text-down" : ""}>{STATUS_TEXT[r.status]}</span>}
        {m.older_apps.length > 0 && <span title={m.older_apps.join(" / ")}>开发者还有 {m.older_apps.length} 个更早的产品</span>}
      </div>
      <h2 className="mt-1 text-base font-semibold leading-snug">{c?.headline ?? r.name}</h2>
      <a href={`/app/${r.appId}?country=${country}`} onClick={onLinkClick} className="mt-1.5 flex items-center gap-2 text-sm hover:underline">
        <AppIcon url={r.iconUrl} size={22} />
        <span className="truncate">{r.name}</span>
        {r.developer && <span className="truncate text-xs text-ink-3">{r.developer}</span>}
      </a>
      <div className="tabular mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-2">{numbers.map((t) => <span key={t}>{t}</span>)}</div>
      {c && <p className="mt-2 text-sm text-ink-2">{c.verdict_reason}</p>}
      {c && c.angles[0] && (
        <p className="mt-1 text-sm text-ink-2"><span className="text-ink-3">切口：</span>{c.angles[0].who}；{c.angles[0].positioning}</p>
      )}
      {checks.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-ink-2">
          {checks.map(([d, x]) => <CheckText key={d} days={d} x={x} />)}
        </div>
      )}
      {c && (
        <button className="mt-2 text-xs text-accent hover:underline" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "收起分析" : "展开分析"}
        </button>
      )}
      {c && open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3 text-sm">
          <Block title="钱在哪里、多大">{c.market.pool}</Block>
          <Block title="市场进得去吗">{c.market.openness}</Block>
          <Block title="为什么现在起量">{c.why_now}</Block>
          <Block title="赢家为什么赢">
            <Field k="做给谁" v={c.winner.who} />
            <Field k="定位" v={c.winner.positioning} />
            <Field k="怎么收钱" v={c.winner.monetization} />
            <Field k="怎么获客" v={c.winner.acquisition} />
          </Block>
          <Block title="抢了谁的用户">{c.whose_users}</Block>
          {c.angles.map((a, i) => (
            <Block key={i} title={`切口 ${i + 1}`}>
              <Field k="人群" v={a.who} />
              <Field k="定位" v={a.positioning} />
              <Field k="和赢家的差别" v={a.vs_winner} />
              <Field k="获客" v={a.acquisition} />
              <Field k="在位者为什么不会马上跟" v={a.why_incumbents_wont_follow} />
            </Block>
          ))}
          <Block title="别的国家">{c.other_markets}</Block>
          {c.risks.length > 0 && (
            <Block title="风险"><ul className="list-disc space-y-0.5 pl-5">{c.risks.map((x) => <li key={x}>{x}</li>)}</ul></Block>
          )}
          <Block title="放弃条件">{c.kill_criteria}</Block>
          {r.quotes.length > 0 && (
            <Block title="评论原话">
              <ul className="space-y-2">
                {r.quotes.map((q) => (
                  <li key={q.id} className="rounded bg-surface-2/60 p-2">
                    <div className="text-xs text-ink-3">{"★".repeat(q.stars)} · {q.date}{q.appId !== r.appId && q.app ? ` · ${q.app}` : ""}</div>
                    <div className="mt-0.5">{q.text}</div>
                    {q.textZh && <div className="mt-0.5 text-ink-3">{q.textZh}</div>}
                  </li>
                ))}
              </ul>
            </Block>
          )}
        </div>
      )}
    </div>
  );
}

function CheckText({ days, x }: { days: string; x: EventCheck }) {
  const what = x.dropped ? "已掉出跟踪的榜单" : x.per_day_since !== null ? `触发以来日均 +${x.per_day_since}` : "没有评分数据";
  return <span className={x.held ? "text-up" : "text-down"}>第 {days} 天复核：{what}，{x.held ? "还在涨" : "已停涨"}</span>;
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div>
      <div className="text-xs font-semibold text-ink-3">{title}</div>
      <div className="mt-0.5 space-y-0.5 text-ink-2">{children}</div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  if (!v) return null;
  return <div><span className="text-ink-3">{k}：</span>{v}</div>;
}

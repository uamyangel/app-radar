import { useEffect, useState } from "react";
import { TOPICS, type Topic } from "@app-radar/shared/topics";
import type { AppResp, Review, ReviewsResp } from "../../functions/_lib/types.ts";
import { getJson, qs } from "../lib/api.ts";
import { ErrorBox } from "./bits.tsx";

type Props = { appId: number; country: string; counts: Record<string, number>; topics: AppResp["topics"]; classified30d: number };
const topicLabel = (t: string) => TOPICS[t as Topic]?.label ?? t;

/**
 * 评论列表：默认低分优先；可按星级筛选、切换为最新优先；分页加载。
 * 不做后台翻译：中文评论标 lang="zh"，让沉浸式翻译跳过；其他语言交给插件自动识别。
 */
export function Reviews({ appId, country, counts, topics, classified30d }: Props) {
  const [rating, setRating] = useState<number | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [sort, setSort] = useState<"low" | "recent">("low");
  const [items, setItems] = useState<Review[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 条件变化时从第一页重新加载
  useEffect(() => { setItems([]); setPage(0); }, [appId, country, rating, sort, topic]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getJson<ReviewsResp>(`/api/apps/${appId}/reviews?${qs({ country, rating, sort, page, topic })}`).then(
      (r) => { if (!alive) return; setItems((xs) => (page === 0 ? r.reviews : [...xs, ...r.reviews])); setHasMore(r.hasMore); setLoading(false); },
      (e: Error) => { if (!alive) return; setError(e.message); setLoading(false); },
    );
    return () => { alive = false; };
  }, [appId, country, rating, sort, page, topic]);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const chip = (active: boolean) =>
    `h-7 rounded-full border px-2.5 text-xs ${active ? "border-ink bg-ink text-surface" : "border-line text-ink-2 hover:bg-surface-2"}`;

  return (
    <div>
      <TopicBars topics={topics} total={classified30d} active={topic} onPick={(t) => setTopic(topic === t ? null : t)} />
      {topic && (
        <div className="mb-2 text-sm">
          只看「{topicLabel(topic)}」 <button className="ml-1 text-accent hover:underline" onClick={() => setTopic(null)}>清除</button>
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button className={chip(rating === null)} onClick={() => setRating(null)}>全部 {total}</button>
        {[1, 2, 3, 4, 5].map((r) => (
          <button key={r} className={chip(rating === r)} onClick={() => setRating(r)} disabled={!counts[String(r)]}>
            {r}★ <span className="tabular">{counts[String(r)] ?? 0}</span>
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-line" />
        <button className={chip(sort === "low")} onClick={() => setSort("low")}>低分优先</button>
        <button className={chip(sort === "recent")} onClick={() => setSort("recent")}>最新优先</button>
      </div>
      {error && <ErrorBox msg={error} />}
      {!loading && !error && items.length === 0 && <div className="py-6 text-center text-sm text-ink-3">还没有采集到评论</div>}
      <ul className="divide-y divide-line">
        {items.map((r) => (
          <li key={r.reviewId} className="py-3">
            <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-3">
              <span className={r.rating <= 2 ? "text-down" : r.rating === 3 ? "text-ink-2" : "text-ink"} aria-label={`${r.rating} 星`}>
                {"★".repeat(r.rating)}<span className="text-line">{"★".repeat(5 - r.rating)}</span>
              </span>
              <span className="tabular">{r.reviewedAt.slice(0, 10)}</span>
              {r.appVersion && <span>v{r.appVersion}</span>}
              {r.author && <span className="truncate">{r.author}</span>}
              {r.topics?.map((t) => (
                <button key={t} onClick={() => setTopic(t)} className="rounded border border-line px-1 text-ink-2 hover:bg-surface-2">{topicLabel(t)}</button>
              ))}
            </div>
            {r.gist && <div lang="zh" className="mt-1 text-sm font-medium text-ink">→ {r.gist}</div>}
            <div lang={r.lang === "zh" ? "zh" : r.lang === "ja" ? "ja" : undefined}>
              {r.title && <div className="mt-1 font-medium">{r.title}</div>}
              <p className="mt-0.5 whitespace-pre-line text-ink-2">{r.content}</p>
            </div>
          </li>
        ))}
      </ul>
      {(hasMore || loading) && (
        <div className="mt-3 text-center">
          <button className="h-8 rounded-md border border-line px-4 text-sm text-ink-2 hover:bg-surface-2 disabled:opacity-50" disabled={loading} onClick={() => setPage((p) => p + 1)}>
            {loading ? "加载中…" : "加载更多"}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 近 30 天评论在说什么。好评通常占大头，单独显示在标题行；
 * 横条只画问题类，按问题类里的最大值缩放，这样问题之间的差别看得清。点击筛选评论。
 */
function TopicBars({ topics, total, active, onPick }: { topics: AppResp["topics"]; total: number; active: string | null; onPick: (t: string) => void }) {
  if (topics.length === 0) return null;
  const praise = topics.find((t) => t.topic === "praise");
  const issues = topics.filter((t) => t.topic !== "praise");
  const max = Math.max(1, ...issues.map((t) => t.n));
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return (
    <div className="mb-4 rounded-lg border border-line p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs text-ink-3">
        <span className="font-semibold text-ink-2">评论在说什么（近 30 天，AI 归类）</span>
        <span className="tabular">
          {praise && (
            <button onClick={() => onPick("praise")} aria-pressed={active === "praise"} className={`mr-2 rounded px-1 hover:bg-surface-2 ${active === "praise" ? "bg-surface-2" : ""}`}>
              好评 {praise.n} 条（{pct(praise.n)}%）
            </button>
          )}
          {total} 条已归类 · 一条可有 1–2 个标签
        </span>
      </div>
      {issues.length === 0 ? <div className="text-sm text-ink-3">近 30 天没有提到具体问题的评论</div> : (
        <ul className="space-y-1">
          {issues.map((t) => (
            <li key={t.topic}>
              <button
                onClick={() => onPick(t.topic)}
                aria-pressed={active === t.topic}
                className={`grid w-full grid-cols-[6.5rem_1fr_auto] items-center gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-surface-2 ${active === t.topic ? "bg-surface-2" : ""}`}
              >
                <span className="truncate text-ink">{topicLabel(t.topic)}</span>
                <span className="h-2 rounded-full bg-surface-2">
                  <span className="block h-2 rounded-full" style={{ width: `${(t.n / max) * 100}%`, background: "var(--s1)" }} />
                </span>
                <span className="tabular w-36 text-right text-xs text-ink-2">
                  {t.n} 条 · {pct(t.n)}% · <span className={t.avgRating < 3 ? "text-down" : ""}>{t.avgRating.toFixed(1)}★</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

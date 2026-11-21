import { useEffect, useState } from "react";
import type { Review, ReviewsResp } from "../../functions/_lib/types.ts";
import { getJson, qs } from "../lib/api.ts";
import { ErrorBox } from "./bits.tsx";

type Props = { appId: number; country: string; counts: Record<string, number> };

/**
 * 评论列表：默认低分优先；可按星级筛选、切换为最新优先；分页加载。
 * 不做后台翻译：中文评论标 lang="zh"，让沉浸式翻译跳过；其他语言交给插件自动识别。
 */
export function Reviews({ appId, country, counts }: Props) {
  const [rating, setRating] = useState<number | null>(null);
  const [sort, setSort] = useState<"low" | "recent">("low");
  const [items, setItems] = useState<Review[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 条件变化时从第一页重新加载
  useEffect(() => { setItems([]); setPage(0); }, [appId, country, rating, sort]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getJson<ReviewsResp>(`/api/apps/${appId}/reviews?${qs({ country, rating, sort, page })}`).then(
      (r) => { if (!alive) return; setItems((xs) => (page === 0 ? r.reviews : [...xs, ...r.reviews])); setHasMore(r.hasMore); setLoading(false); },
      (e: Error) => { if (!alive) return; setError(e.message); setLoading(false); },
    );
    return () => { alive = false; };
  }, [appId, country, rating, sort, page]);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const chip = (active: boolean) =>
    `h-7 rounded-full border px-2.5 text-xs ${active ? "border-ink bg-ink text-surface" : "border-line text-ink-2 hover:bg-surface-2"}`;

  return (
    <div>
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
            </div>
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

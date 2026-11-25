import { useEffect, useReducer } from "react";
import type { ReviewFavorite, ReviewFavoritesResp } from "../../functions/_lib/types.ts";
import { clearCache, getJson, postJson } from "./api.ts";

/** 收藏的评论：数量不多，进页面时一次取全，之后本地维护 */
let items: Record<string, ReviewFavorite> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const fn of listeners) fn(); };

function load() {
  loading ??= getJson<ReviewFavoritesResp>("/api/review-favorites").then(
    (r) => { items = r.items; notify(); },
    () => { loading = null; },
  );
}

export function useReviewFavs() {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { listeners.add(rerender); load(); return () => { listeners.delete(rerender); }; }, []);
  return items;
}

export async function saveReviewFav(reviewId: string, starred: boolean, note: string | null) {
  await postJson("/api/review-favorites", { reviewId, starred, note });
  items = { ...(items ?? {}) };
  if (starred) items[reviewId] = { note }; else delete items[reviewId];
  clearCache("/api/favorites");
  clearCache("/api/review-favorites");
  notify();
}

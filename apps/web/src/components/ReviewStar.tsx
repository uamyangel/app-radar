import { useEffect, useState } from "react";
import { saveReviewFav, useReviewFavs } from "../lib/reviewFavs.ts";

/** 收藏一条评论；收藏后可以写一句备注（回车或离开输入框时保存） */
export function ReviewStar({ reviewId }: { reviewId: string }) {
  const favs = useReviewFavs();
  const fav = favs?.[reviewId];
  const [note, setNote] = useState(fav?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setNote(fav?.note ?? ""); }, [fav?.note]);

  const save = async (starred: boolean, text: string | null) => {
    setSaving(true);
    setError(null);
    try { await saveReviewFav(reviewId, starred, text); } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };
  if (!favs) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button
        disabled={saving}
        onClick={(e) => { e.preventDefault(); void save(!fav, null); }}
        aria-pressed={!!fav}
        title={fav ? "取消收藏这条评论" : "收藏这条评论"}
        className={`rounded px-1 text-xs disabled:opacity-50 ${fav ? "text-accent" : "text-ink-3 hover:text-ink"}`}
      >
        {fav ? "★ 已收藏" : "☆ 收藏"}
      </button>
      {fav && (
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => { if (note !== (fav.note ?? "")) void save(true, note || null); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          placeholder="备注（可选）"
          maxLength={500}
          className="h-6 w-48 rounded border border-line bg-surface px-1.5 text-xs"
        />
      )}
      {error && <span className="text-xs text-down">{error}</span>}
    </span>
  );
}

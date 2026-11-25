import { useEffect, useState } from "react";
import type { Favorite, FavoriteResp } from "../../functions/_lib/types.ts";
import { clearCache, postJson, useApi } from "../lib/api.ts";

/** 收藏这个 App；收藏后可以写一句为什么收藏，以后回看时知道当初看中它什么 */
export function FavoriteButton({ appId, country }: { appId: number; country: string }) {
  const res = useApi<FavoriteResp>(`/api/favorites/${appId}`);
  const [fav, setFav] = useState<Favorite | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!res.data) return;
    setFav(res.data.favorite);
    setNote(res.data.favorite?.note ?? "");
  }, [res.data]);

  const save = async (starred: boolean, noteText = note) => {
    setSaving(true);
    setError(null);
    try {
      const r = await postJson<FavoriteResp>("/api/favorites", { appId, country, starred, note: noteText || null });
      setFav(r.favorite);
      if (!r.favorite) setNote("");
      clearCache("/api/favorites");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (res.error) return <span className="text-xs text-down">收藏状态加载失败</span>;
  const on = !!fav;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <button
          disabled={saving || res.loading}
          onClick={() => save(!on)}
          aria-pressed={on}
          className={`h-8 rounded-md border px-3 text-sm disabled:opacity-50 ${on ? "border-accent bg-accent/10 text-accent" : "border-line text-ink-2 hover:bg-surface-2"}`}
        >
          {on ? "★ 已收藏" : "☆ 收藏"}
        </button>
        {error && <span className="text-xs text-down">{error}</span>}
      </div>
      {on && (
        <div className="flex items-start gap-1.5">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="为什么收藏（可选）"
            maxLength={500}
            rows={2}
            className="w-full max-w-md rounded-md border border-line bg-surface px-2 py-1 text-sm"
          />
          <button
            disabled={saving || note === (fav.note ?? "")}
            onClick={() => save(true, note)}
            className="h-8 shrink-0 rounded-md border border-line px-2 text-xs text-ink-2 hover:bg-surface-2 disabled:opacity-40"
          >
            保存
          </button>
        </div>
      )}
    </div>
  );
}

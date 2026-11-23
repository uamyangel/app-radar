import { useState } from "react";
import type { Feedback } from "../../functions/_lib/types.ts";
import { clearCache, postJson } from "../lib/api.ts";

type Props = { needId: number; country: string; initial: Feedback | null; withNote?: boolean };

/** 「有价值 / 没价值」：再点一次同一个按钮撤销。标了「没价值」的默认从机会列表隐藏，本地流水线也不再为它重写卡片 */
export function FeedbackButtons({ needId, country, initial, withNote = false }: Props) {
  const [fb, setFb] = useState<Feedback | null>(initial);
  const [note, setNote] = useState(initial?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (verdict: "up" | "down" | null, noteText = note) => {
    setSaving(true);
    setError(null);
    try {
      const r = await postJson<{ feedback: Feedback | null }>("/api/feedback", { needId, country, verdict, note: noteText || null });
      setFb(r.feedback);
      clearCache("/api/opps");
      clearCache(`/api/needs/${needId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const btn = (active: boolean, tone: "up" | "down") =>
    `h-7 rounded-md border px-2 text-xs disabled:opacity-50 ${active ? (tone === "up" ? "border-up bg-up/10 text-up" : "border-down bg-down/10 text-down") : "border-line text-ink-2 hover:bg-surface-2"}`;

  return (
    <div onClick={(e) => e.preventDefault()} className="inline-flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <button disabled={saving} className={btn(fb?.verdict === "up", "up")} onClick={() => save(fb?.verdict === "up" ? null : "up")} aria-pressed={fb?.verdict === "up"}>👍 有价值</button>
        <button disabled={saving} className={btn(fb?.verdict === "down", "down")} onClick={() => save(fb?.verdict === "down" ? null : "down")} aria-pressed={fb?.verdict === "down"}>👎 没价值</button>
        {error && <span className="text-xs text-down">{error}</span>}
      </div>
      {withNote && fb && (
        <div className="flex items-start gap-1.5">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="备注（为什么有价值或没价值，可选）"
            maxLength={500}
            rows={2}
            className="w-72 rounded-md border border-line bg-surface px-2 py-1 text-xs"
          />
          <button disabled={saving || note === (fb.note ?? "")} className="h-7 rounded-md border border-line px-2 text-xs text-ink-2 hover:bg-surface-2 disabled:opacity-40" onClick={() => save(fb.verdict, note)}>保存</button>
        </div>
      )}
    </div>
  );
}

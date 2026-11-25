import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { SeenKind, SeenResp } from "../../functions/_lib/types.ts";
import { qs } from "./api.ts";

/**
 * 看过的卡片：在屏幕上停留 5 秒以上，或点开了详情，就记为看过。存数据库，手机和电脑共用。
 * 本地先记下、立刻更新界面；攒一批再写（3 秒内的合在一起），离开页面时也会发出去。
 */
export const DWELL_MS = 5000;

/** `${kind}|${key}` -> 看的时候的版本；undefined = 还没查过；NONE = 查过、没看过 */
const NONE = Symbol("none");
const known = new Map<string, string | null | typeof NONE>();
const id = (kind: SeenKind, key: string) => `${kind}|${key}`;
const listeners = new Set<() => void>();
const notify = () => { for (const fn of listeners) fn(); };

let queue: { kind: SeenKind; key: string; ver: string | null }[] = [];
let timer: number | undefined;

function flush(keepalive = false) {
  if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
  if (queue.length === 0) return;
  const items = queue.splice(0, 300);
  fetch("/api/seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }), keepalive })
    .then((r) => { if (!r.ok) throw new Error(String(r.status)); })
    .catch(() => { queue.unshift(...items); }); // 失败的留着，下次一起发
  if (queue.length) flush(keepalive);
}
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => { if (document.hidden) flush(true); });
  window.addEventListener("pagehide", () => flush(true));
}

export function markSeen(kind: SeenKind, key: string, ver: string | null) {
  if (known.get(id(kind, key)) === ver) return;
  known.set(id(kind, key), ver);
  queue.push({ kind, key, ver });
  if (timer === undefined) timer = window.setTimeout(() => flush(), 3000);
  notify();
}

export type SeenState = "unseen" | "updated" | "seen";

/** 没看过；看过但卡片后来重写了（版本不同）算「有更新」 */
function stateOf(stored: string | null | typeof NONE | undefined, ver: string | null): SeenState | null {
  if (stored === undefined) return null; // 还在查
  if (stored === NONE) return "unseen";
  return ver !== null && stored !== ver ? "updated" : "seen";
}

/** 一组卡片的看过状态。返回 null 表示还没查完 */
export function useSeen(kind: SeenKind, items: { key: string; ver: string | null }[]) {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { listeners.add(rerender); return () => { listeners.delete(rerender); }; }, []);
  const keysSig = items.map((i) => i.key).join(",");

  useEffect(() => {
    const missing = items.map((i) => i.key).filter((k) => !known.has(id(kind, k)));
    if (missing.length === 0) return;
    let alive = true;
    (async () => {
      for (let i = 0; i < missing.length; i += 150) {
        const chunk = missing.slice(i, i + 150);
        try {
          const r = await fetch(`/api/seen?${qs({ kind, keys: chunk.join(",") })}`);
          if (!r.ok) throw new Error(String(r.status));
          const d = (await r.json()) as SeenResp;
          for (const k of chunk) if (!known.has(id(kind, k))) known.set(id(kind, k), k in d.seen ? d.seen[k]! : NONE);
        } catch {
          return; // 查不到就不显示标记，不影响浏览
        }
      }
      if (alive) notify();
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, keysSig]);

  const states = new Map(items.map((i) => [i.key, stateOf(known.get(id(kind, i.key)), i.ver)]));
  const ready = items.length === 0 || [...states.values()].every((s) => s !== null);
  return { states, ready };
}

/**
 * 「只看没看过的」：按进入页面时的状态过滤，看的过程中标为看过的卡片不会突然消失、让页面跳动。
 * 数据换了（切国家、换分类）才重新取一次。
 */
export function useUnseenSnapshot(ready: boolean, states: Map<string, SeenState | null>, dataKey: unknown) {
  const [snap, setSnap] = useState<{ dataKey: unknown; keys: Set<string> } | null>(null);
  useEffect(() => {
    if (!ready || (snap && snap.dataKey === dataKey)) return;
    setSnap({ dataKey, keys: new Set([...states].filter(([, s]) => s !== "seen").map(([k]) => k)) });
  }, [ready, dataKey, snap, states]);
  return snap && snap.dataKey === dataKey ? snap.keys : null;
}

/** 元素在屏幕上停留 5 秒（占视口一半以上，或自身 60% 以上可见）就调用 onSeen；页面切到后台时暂停计时 */
export function useDwell<T extends Element>(onSeen: () => void, enabled: boolean) {
  const ref = useRef<T>(null);
  const cb = useRef(onSeen);
  cb.current = onSeen;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let t: number | undefined;
    let visible = false;
    const stop = () => { if (t !== undefined) { clearTimeout(t); t = undefined; } };
    const start = () => { if (t === undefined && visible && !document.hidden) t = window.setTimeout(() => { cleanup(); cb.current(); }, DWELL_MS); };
    const io = new IntersectionObserver(([e]) => {
      if (!e) return;
      visible = e.intersectionRatio >= 0.6 || e.intersectionRect.height >= window.innerHeight * 0.5;
      if (visible) start(); else stop();
    }, { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] });
    const onVis = () => (document.hidden ? stop() : start());
    const cleanup = () => { stop(); io.disconnect(); document.removeEventListener("visibilitychange", onVis); };
    io.observe(el);
    document.addEventListener("visibilitychange", onVis);
    return cleanup;
  }, [enabled]);
  return ref;
}

/** 只在第一次渲染时用 useMemo 算一次的 items，避免每次渲染都换引用 */
export const useSeenItems = <T,>(rows: T[] | undefined, fn: (r: T) => { key: string; ver: string | null }) =>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useMemo(() => (rows ?? []).map(fn), [rows]);

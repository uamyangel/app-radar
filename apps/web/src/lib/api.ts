import { useEffect, useState } from "react";

/** 同一会话内相同请求只发一次（数据每天才更新） */
const cache = new Map<string, Promise<unknown>>();

export function getJson<T>(url: string): Promise<T> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then(async (r) => {
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((body as { error?: string }).error ?? `请求失败（${r.status}）`);
      return body;
    });
    p.catch(() => cache.delete(url)); // 失败的不缓存，允许重试
    cache.set(url, p);
  }
  return p as Promise<T>;
}

export type Loadable<T> = { data: T | undefined; error: string | null; loading: boolean };

export function useApi<T>(url: string | null): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({ data: undefined, error: null, loading: !!url });
  useEffect(() => {
    if (!url) return;
    let alive = true;
    setState((s) => ({ data: s.data, error: null, loading: true }));
    getJson<T>(url).then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (e: Error) => alive && setState({ data: undefined, error: e.message, loading: false }),
    );
    return () => {
      alive = false;
    };
  }, [url]);
  return state;
}

export const qs = (params: Record<string, string | number | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  return p.toString();
};

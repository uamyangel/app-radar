import { CHART_TYPES, COUNTRY_CODES, GENRES } from "@app-radar/shared";
import type { Db } from "@app-radar/shared/db";
import { z } from "zod";
import { dbFor, type Env } from "./db.ts";

export const Country = z.enum(COUNTRY_CODES as [string, ...string[]]);
export const Genre = z.coerce.number().int().refine((g) => g in GENRES, "未知品类");
export const Chart = z.enum(CHART_TYPES);
export const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const AppId = z.coerce.number().int().positive();

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export const notFound = (msg: string) => new HttpError(404, msg);

const CACHE_SECONDS = 600; // 数据每天只更新一次

/**
 * 只读 API 的统一外壳：校验参数（query + 路由参数）→ 查库 → JSON。
 * 线上用 Cache API 缓存 10 分钟；本地开发不缓存。
 */
export function api<S extends z.ZodTypeAny>(
  schema: S,
  fn: (q: z.infer<S>, db: Db) => Promise<unknown>,
  opts: { cache?: boolean } = {}, // 带反馈状态的接口不缓存（标完要立刻看到）
): PagesFunction<Env> {
  const useCache = opts.cache ?? true;
  return async (c) => {
    const url = new URL(c.request.url);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const cache = local || !useCache ? null : (caches as unknown as { default: Cache }).default;
    if (cache) {
      const hit = await cache.match(c.request);
      if (hit) return hit;
    }
    const raw = { ...Object.fromEntries(url.searchParams), ...(c.params as Record<string, string>) };
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
    const { db, close } = dbFor(c.env);
    try {
      const data = await fn(parsed.data, db);
      const res = Response.json(data, { headers: { "Cache-Control": useCache ? `private, max-age=${CACHE_SECONDS}` : "no-store" } });
      if (cache) c.waitUntil(cache.put(c.request, res.clone()));
      return res;
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      console.error(e);
      return Response.json({ error: "服务器错误" }, { status: 500 });
    } finally {
      c.waitUntil(close());
    }
  };
}

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

/** 本地库不用 SSL；其他（Railway 公网代理）要求 SSL，否则连接会被直接关闭 */
export function sslFor(url: string): false | "require" {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host.startsWith("/") ? false : "require";
}

export function createDb(url: string, opts: { max?: number } = {}) {
  const client = postgres(url, { max: opts.max ?? 5, prepare: false, ssl: sslFor(url), onnotice: () => {} });
  return { db: drizzle(client, { schema }), client };
}
export type Db = ReturnType<typeof createDb>["db"];

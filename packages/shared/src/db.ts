import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

export function createDb(url: string, opts: { max?: number } = {}) {
  const client = postgres(url, { max: opts.max ?? 5, prepare: false, onnotice: () => {} });
  return { db: drizzle(client, { schema }), client };
}
export type Db = ReturnType<typeof createDb>["db"];

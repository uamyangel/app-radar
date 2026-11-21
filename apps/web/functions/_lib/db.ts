import { createDb } from "@app-radar/shared/db";

export type Env = {
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL_RO?: string; // 本地开发用（.dev.vars），线上走 Hyperdrive
};

/** 每个请求一个连接；调用方在查询全部完成后调用 close（end() 之后的新查询会被拒绝） */
export function dbFor(env: Env) {
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL_RO;
  if (!url) throw new Error("没有数据库连接：缺少 HYPERDRIVE 绑定或 DATABASE_URL_RO");
  const conn = createDb(url, { max: 1 });
  return { db: conn.db, close: () => conn.client.end({ timeout: 5 }) };
}

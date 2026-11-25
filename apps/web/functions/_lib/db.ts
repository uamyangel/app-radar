import { createDb } from "@app-radar/shared/db";

export type Env = {
  HYPERDRIVE?: { connectionString: string };
  FEEDBACK_DB?: { connectionString: string }; // 写入账号：只能读写 feedback、favorites、favorite_reviews、seen
  DATABASE_URL_RO?: string; // 本地开发用（.dev.vars，指向本机的数据副本）
  ACCESS_TEAM_DOMAIN?: string; // Cloudflare Access 团队域名，例如 xxx.cloudflareaccess.com
  ACCESS_AUD?: string; // Access 应用的 AUD 标签
};

/**
 * 每个请求一个连接；调用方在查询全部完成后调用 close（end() 之后的新查询会被拒绝）。
 * 线上走 Hyperdrive：Worker 到 Hyperdrive 这段由运行时负责，不要再套 TLS；Hyperdrive 到 Railway 那段用 TLS。
 */
export function dbFor(env: Env) {
  const conn = env.HYPERDRIVE
    ? createDb(env.HYPERDRIVE.connectionString, { max: 1, ssl: false })
    : env.DATABASE_URL_RO
      ? createDb(env.DATABASE_URL_RO, { max: 1 })
      : null;
  if (!conn) throw new Error("没有数据库连接：缺少 HYPERDRIVE 绑定或 DATABASE_URL_RO");
  return { db: conn.db, close: () => conn.client.end({ timeout: 5 }) };
}

/** 写入用的连接：账号只能读写 feedback、favorites、favorite_reviews、seen */
export function feedbackDbFor(env: Env) {
  const conn = env.FEEDBACK_DB ? createDb(env.FEEDBACK_DB.connectionString, { max: 1, ssl: false }) : null;
  if (!conn) throw new Error("没有反馈数据库连接：缺少 FEEDBACK_DB 绑定");
  return { db: conn.db, close: () => conn.client.end({ timeout: 5 }) };
}

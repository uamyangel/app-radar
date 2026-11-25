/**
 * 创建网站的写入账号：只能读写 feedback（需求反馈）、favorites（收藏的 App）、favorite_reviews（收藏的评论）、seen（看过的卡片），其他表一概没有权限。
 * 只读账号 app_radar_ro 保持只读，不受影响。
 *
 * 用法：DATABASE_URL=<管理员连接串> [OUT=apps/web/.dev.vars] pnpm db:setup-feedback
 * 效果：创建或重置角色 app_radar_feedback（随机密码），连接串写进 OUT 文件（默认 .env）的 DATABASE_URL_FEEDBACK，不打印。
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { sslFor } from "../packages/shared/src/db.ts";

const admin = process.env.DATABASE_URL;
if (!admin) throw new Error("缺少 DATABASE_URL");
const ROLE = "app_radar_feedback";
const WRITABLE = ["feedback", "favorites", "favorite_reviews", "seen"];
const password = randomBytes(24).toString("base64url");
const sql = postgres(admin, { max: 1, ssl: sslFor(admin), onnotice: () => {} });
const db = (await sql`select current_database() as d`)[0]!;
const exists = (await sql`select 1 from pg_roles where rolname = ${ROLE}`).length > 0;
// 角色名是常量，密码是 base64url（无引号），可以安全拼接
await sql.unsafe(`${exists ? "alter" : "create"} role ${ROLE} with login password '${password}'`);
await sql.unsafe(`grant connect on database "${db.d}" to ${ROLE}`);
await sql.unsafe(`grant usage on schema public to ${ROLE}`);
await sql.unsafe(`revoke all on all tables in schema public from ${ROLE}`);
for (const t of WRITABLE) await sql.unsafe(`grant select, insert, update, delete on ${t} to ${ROLE}`);
await sql.end();

// 验证：能写这几张表，读不到也写不了别的表
const u = new URL(admin);
u.username = ROLE;
u.password = password;
const fb = postgres(u.toString(), { max: 1, ssl: sslFor(admin), onnotice: () => {} });
await fb`insert into feedback (need_id, country, verdict, created_at, updated_at) values (-1, 'zz', 'up', now(), now()) on conflict do nothing`;
await fb`delete from feedback where need_id = -1 and country = 'zz'`;
await fb`insert into favorites (app_id, country, created_at, updated_at) values (-1, 'zz', now(), now()) on conflict do nothing`;
await fb`delete from favorites where app_id = -1`;
await fb`insert into seen (kind, key, seen_at) values ('zz', 'zz', now()) on conflict do nothing`;
await fb`delete from seen where kind = 'zz'`;
await fb`insert into favorite_reviews (review_id, created_at, updated_at) values ('zz', now(), now()) on conflict do nothing`;
await fb`delete from favorite_reviews where review_id = 'zz'`;
let readBlocked = false;
try { await fb`select 1 from apps limit 1`; } catch { readBlocked = true; }
let writeBlocked = false;
try { await fb`delete from job_runs where id = -1`; } catch { writeBlocked = true; }
await fb.end();
if (!readBlocked || !writeBlocked) throw new Error("写入账号能访问允许范围以外的表，检查权限配置");

const out = process.env.OUT ?? ".env";
const line = `DATABASE_URL_FEEDBACK=${u.toString()}`;
const env = existsSync(out) ? readFileSync(out, "utf8") : "";
writeFileSync(out, env.match(/^DATABASE_URL_FEEDBACK=.*$/m) ? env.replace(/^DATABASE_URL_FEEDBACK=.*$/m, line) : `${env.trimEnd()}\n${line}\n`);
console.log(`反馈账号 ${ROLE} 已${exists ? "重置密码" : "创建"}：能读写 ${WRITABLE.join("、")}，其他表读写都被拒绝。连接串已写入 ${out} 的 DATABASE_URL_FEEDBACK`);

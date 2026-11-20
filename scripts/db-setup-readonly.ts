/**
 * 创建前端 API 用的只读账号（SPEC 第 10 节：前端账号只授予只读权限，和采集账号分开）。
 *
 * 用法：DATABASE_URL=<管理员连接串> pnpm tsx scripts/db-setup-readonly.ts
 * 效果：创建或重置角色 app_radar_ro（随机密码），授予 public 下所有表的 SELECT，
 *       包括以后新建的表；只读连接串写进 .env 的 DATABASE_URL_RO，不打印到终端。
 * 重复执行是安全的：会轮换密码。
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import postgres from "postgres";

const admin = process.env.DATABASE_URL;
if (!admin) throw new Error("缺少 DATABASE_URL");
const ROLE = "app_radar_ro";
const password = randomBytes(24).toString("base64url");

const sql = postgres(admin, { max: 1, onnotice: () => {} });
const db = (await sql`select current_database() as d, current_user as u`)[0]!;
const exists = (await sql`select 1 from pg_roles where rolname = ${ROLE}`).length > 0;
// 角色名和密码无法参数化，ROLE 是常量，密码是 base64url（无引号），可以安全拼接
await sql.unsafe(`${exists ? "alter" : "create"} role ${ROLE} with login password '${password}'`);
await sql.unsafe(`alter role ${ROLE} set default_transaction_read_only = on`);
await sql.unsafe(`grant connect on database "${db.d}" to ${ROLE}`);
await sql.unsafe(`grant usage on schema public to ${ROLE}`);
await sql.unsafe(`grant select on all tables in schema public to ${ROLE}`);
await sql.unsafe(`alter default privileges for role "${db.u}" in schema public grant select on tables to ${ROLE}`);
await sql.end();

// 验证：只读账号能读、不能写
const u = new URL(admin);
u.username = ROLE;
u.password = password;
const ro = postgres(u.toString(), { max: 1, onnotice: () => {} });
await ro`select count(*) from job_runs`;
let blocked = false;
try { await ro`insert into job_runs (started_at, stage, status) values (now(), 'ro-test', 'x')`; } catch { blocked = true; }
await ro.end();
if (!blocked) throw new Error("只读账号居然能写入，检查权限配置");

const line = `DATABASE_URL_RO=${u.toString()}`;
const env = existsSync(".env") ? readFileSync(".env", "utf8") : "";
writeFileSync(".env", env.match(/^DATABASE_URL_RO=.*$/m) ? env.replace(/^DATABASE_URL_RO=.*$/m, line) : `${env.trimEnd()}\n${line}\n`);
console.log(`只读账号 ${ROLE} 已${exists ? "重置密码" : "创建"}：能读、写入被拒绝。连接串已写入 .env 的 DATABASE_URL_RO`);

/**
 * 定时自动运行的前置检查和收尾（pnpm insights auto，由 launchd 每 30 分钟、开机和醒来时触发）。
 *
 * 合盖不出错、打开能继续，靠的是：
 *   - 每一批处理完立刻在事务里写库，中断只丢正在处理的那一批，下次只做剩下的（流水线本身的设计）
 *   - 合盖时进程被挂起，打开后接着跑；如果休眠期间连接断了，这次运行失败退出，30 分钟内下一次触发会接着做
 *   - 看门狗只计醒着的时间：醒着时 25 分钟没有任何进展才判定卡死并退出，合盖多久都不会误杀
 *     （Node 的 performance.now 在 macOS 上会把休眠时间算进去，2026-11-23 实测合盖时被误杀过，所以自己检测休眠）
 *   - 同一时间只跑一个（PID 文件 + 数据库锁）
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "@app-radar/shared/config";
import type { Db } from "@app-radar/shared/db";
import { sql } from "@app-radar/shared/orm";
import { extractFilters } from "./extract.ts";
import { log, onProgress } from "./runner.ts";

const STATE_DIR = join(homedir(), "Library", "Application Support", "app-radar");
const PID_FILE = join(STATE_DIR, "insights-auto.pid");
const FAIL_FILE = join(STATE_DIR, "insights-auto.failures");
const STALL_MS = 25 * 60_000;

export function notify(text: string) {
  try {
    execFileSync("osascript", ["-e", `display notification ${JSON.stringify(text)} with title "App Radar"`], { stdio: "ignore", timeout: 10_000 });
  } catch { /* 通知失败不影响运行 */ }
}

/** 上一次还在跑就返回 false；否则占住 PID 文件，进程退出时释放 */
export function acquireSingleton(): boolean {
  mkdirSync(STATE_DIR, { recursive: true });
  if (existsSync(PID_FILE)) {
    const pid = Number(readFileSync(PID_FILE, "utf8"));
    try { if (pid && pid !== process.pid) { process.kill(pid, 0); return false; } } catch { /* 进程已不存在：上次异常退出，接管 */ }
  }
  writeFileSync(PID_FILE, String(process.pid));
  process.on("exit", () => { try { if (readFileSync(PID_FILE, "utf8") === String(process.pid)) rmSync(PID_FILE); } catch { /* 已删除 */ } });
  return true;
}

/** 没插电源且电量低于阈值时不跑 */
export function powerOk(minBattery: number): { ok: boolean; desc: string } {
  try {
    const out = execFileSync("pmset", ["-g", "batt"], { encoding: "utf8" });
    const ac = out.includes("AC Power");
    const pct = Number(/(\d+)%/.exec(out)?.[1] ?? 100);
    return { ok: ac || pct >= minBattery, desc: ac ? `电源，电量 ${pct}%` : `电池 ${pct}%` };
  } catch {
    return { ok: true, desc: "未知（台式机）" };
  }
}

/** 有没有待办：未提取的评论、未归并的提法、分数比最新数据旧、卡片还没跟上最新分数 */
export async function pendingWork(db: Db, cfg: Config) {
  const countries = cfg.countries as string[];
  const [x] = await db.execute<{ extract: number; assign: number; score_stale: boolean; cards_stale: boolean }>(sql`
    with last as (
      select max(finished_at) filter (where stage = 'insights:score' and status <> 'failed') score_at,
             max(finished_at) filter (where stage = 'insights:cards' and status = 'ok') cards_at,
             max(finished_at) filter (where stage = 'signals' and status = 'ok') signals_at
      from job_runs)
    select (select count(*) ${extractFilters(cfg, countries, null)})::int extract,
           (select count(*) from review_statements where need_id is null)::int assign,
           coalesce((select max(assigned_at) from review_statements) > last.score_at or last.signals_at > last.score_at, last.score_at is null) score_stale,
           coalesce(last.cards_at < last.score_at, true) cards_stale
    from last`);
  const w = x ?? { extract: 0, assign: 0, score_stale: false, cards_stale: false };
  return { ...w, any: w.extract > 0 || w.assign > 0 || w.score_stale || w.cards_stale };
}

/**
 * 看门狗：每 30 秒检查一次；两次检查间隔超过 2 分钟说明电脑睡过，这段时间不算。
 * 醒着的时间累计 25 分钟没有任何进展（日志）才退出。
 */
export function startWatchdog() {
  const TICK = 30_000;
  let prev = Date.now();
  let idle = 0; // 自上次进展以来醒着的毫秒数
  onProgress(() => { idle = 0; });
  const t = setInterval(() => {
    const now = Date.now();
    const gap = now - prev;
    prev = now;
    if (gap > 4 * TICK) { log("auto", `电脑休眠了约 ${Math.round(gap / 60_000)} 分钟，醒来继续`); return; }
    idle += gap;
    if (idle > STALL_MS) {
      log("auto", `醒着的 ${STALL_MS / 60_000} 分钟内没有任何进展，判定卡住，退出；下次触发会接着做`);
      recordOutcome(false, "运行卡住");
      process.exit(2); // exit 时会结束子进程（providers.ts）
    }
  }, TICK);
  t.unref();
}

/** 连续失败计数：偶尔一次中断（比如合盖断网）不打扰，连续 3 次才通知 */
export function recordOutcome(ok: boolean, message: string) {
  const n = ok ? 0 : (existsSync(FAIL_FILE) ? Number(readFileSync(FAIL_FILE, "utf8")) || 0 : 0) + 1;
  writeFileSync(FAIL_FILE, String(n));
  if (!ok && n === 3) notify(`自动分析连续 3 次失败：${message.slice(0, 120)}。日志在 ~/Library/Logs/app-radar/insights.log`);
}

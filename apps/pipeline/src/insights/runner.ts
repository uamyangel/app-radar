/** 本地 AI 运行的公共部分：调用计数、JSON 校验重试、job_runs 记录、并发锁 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "@app-radar/shared/config";
import type { Db } from "@app-radar/shared/db";
import { jobRuns } from "@app-radar/shared";
import { sql } from "@app-radar/shared/orm";
import type { z } from "zod";
import { complete, extractJson, QuotaExceeded, type Provider } from "./providers.ts";

export type RunCtx = {
  cfg: Config;
  db: Db;
  provider: Provider;
  model: string | undefined; // 当前步骤用的模型（由 CLI 按 --model-<步骤> 切换）
  countries: string[];
  genres: number[] | null; // null = 白名单全部
  maxCalls: number; // 本次运行所有 AI 步骤合计最多调用多少次
  concurrency: number; // 提取时同时发出几个调用（太大容易撞订阅的频率上限）
  calls: number;
  costUsd: number; // claude 会报告按 API 价格折算的费用（订阅内不实际扣费，仅供参考用量）
  stopped: string | null; // 撞额度或达到调用上限时的原因
};

const progressListeners: (() => void)[] = [];
/** 每打一行日志算一次进展（定时运行的看门狗用） */
export const onProgress = (fn: () => void) => { progressListeners.push(fn); };
export const log = (step: string, msg: string) => {
  console.log(`${new Date().toISOString().slice(11, 19)} [insights:${step}] ${msg}`);
  for (const fn of progressListeners) fn();
};

/** 调用一次并按 schema 校验；不合格重试一次。额度用完或达到调用上限时返回 null 并设置 ctx.stopped */
export async function ask<S extends z.ZodTypeAny>(ctx: RunCtx, schema: S, system: string, user: string): Promise<z.infer<S> | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (ctx.stopped) return null;
    if (ctx.calls >= ctx.maxCalls) { ctx.stopped = `达到本次调用上限 ${ctx.maxCalls}`; return null; }
    ctx.calls++;
    let text: string | null = null;
    try {
      const r = await complete(ctx.provider, ctx.model, system, user);
      ctx.costUsd += r.costUsd ?? 0;
      text = r.text;
      const parsed = schema.safeParse(extractJson(r.text));
      if (parsed.success) return parsed.data;
      log("ask", `返回格式不对（第 ${attempt + 1} 次）：${parsed.error.issues.slice(0, 2).map((i) => `${i.path.join(".")} ${i.message}`).join("；")}${saveBad(ctx, text)}`);
    } catch (e) {
      if (e instanceof QuotaExceeded) { ctx.stopped = `订阅额度或频率上限：${e.message.slice(0, 200)}`; return null; }
      log("ask", `调用失败（第 ${attempt + 1} 次）：${String(e).slice(0, 300)}${text === null ? "" : saveBad(ctx, text)}`);
    }
  }
  return null;
}

/** 模型返回了却解析不了时，把原文存下来（只留最近 50 个），日志里给出文件名，方便查是哪里坏了 */
const BAD_DIR = join(homedir(), "Library", "Logs", "app-radar", "bad-outputs");
function saveBad(ctx: RunCtx, text: string): string {
  try {
    mkdirSync(BAD_DIR, { recursive: true });
    const file = join(BAD_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}-${ctx.provider}-${ctx.model ?? "default"}.txt`);
    writeFileSync(file, text);
    for (const old of readdirSync(BAD_DIR).sort().slice(0, -50)) rmSync(join(BAD_DIR, old), { force: true });
    return `；原文：${file}`;
  } catch {
    return "";
  }
}

/** 同一时间只允许一个本地运行（Postgres advisory lock，连接断开自动释放） */
/** 另一个运行（手动或定时）正占着锁 */
export class LockBusy extends Error {
  constructor() { super("另一个 insights 运行正在进行（或上次异常退出的连接还没断开），稍后再试"); }
}

export async function withLock<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  const [r] = await db.execute<{ ok: boolean }>(sql`select pg_try_advisory_lock(hashtext('app-radar-insights')) ok`);
  if (!r?.ok) throw new LockBusy();
  try {
    return await fn();
  } finally {
    await db.execute(sql`select pg_advisory_unlock(hashtext('app-radar-insights'))`);
  }
}

/** 每个步骤记一条 job_runs（stage = insights:步骤名），stats 里有用的订阅、模型和调用次数 */
export async function recordStep(ctx: RunCtx, step: string, started: Date, stats: Record<string, unknown>, status: "ok" | "partial" | "failed") {
  await ctx.db.insert(jobRuns).values({
    startedAt: started, finishedAt: new Date(), stage: `insights:${step}`, status,
    stats: { ...stats, provider: ctx.provider, model: ctx.model ?? "(默认)", stopped: ctx.stopped },
  });
}

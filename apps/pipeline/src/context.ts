import type { Config } from "@app-radar/shared/config";
import type { Db } from "@app-radar/shared/db";
import { jobRuns, type ChartType, type Country } from "@app-radar/shared";
import { eq } from "drizzle-orm";
import { HttpClient } from "./http.ts";

export type Ctx = {
  cfg: Config;
  db: Db | null; // dry-run 时为 null
  http: HttpClient;
  date: string; // 快照日期（北京时间）
  countries: Country[];
  genres: number[];
  charts: ChartType[];
  dryRun: boolean;
  deadline: number; // 时间戳，超过后各阶段尽快收尾
  limit: number | null; // 调试用：每个阶段最多处理 N 个单位（评论阶段=App，归类=批，摘要=App，简报=品类）
  current?: Job; // 正在运行的阶段，异常退出时由 CLI 标记为 failed
  /** dry-run 下前一阶段的结果放在内存里传给下一阶段 */
  mem: {
    snapshots?: { country: Country; genreId: number; chartType: ChartType; appIds: number[] }[];
    appGenres?: Map<string, number | null>; // `${cc}:${id}` -> primaryGenreId
  };
};

export const log = (stage: string, msg: string) =>
  console.log(`${new Date().toISOString().slice(11, 19)} [${stage}] ${msg}`);

/** 每个阶段一条 job_runs 记录；errors 只保留前 200 条，避免撑爆 jsonb */
export class Job {
  stats: Record<string, unknown> = {};
  errors: { at: string; msg: string }[] = [];
  errorCount = 0;
  id: number | null = null;
  private started = new Date();
  private httpBase: HttpClient["stats"];

  constructor(private ctx: Ctx, readonly stage: string) {
    this.httpBase = structuredClone(ctx.http.stats);
  }

  async start() {
    this.ctx.current = this;
    log(this.stage, `开始（date=${this.ctx.date}${this.ctx.dryRun ? "，dry-run" : ""}）`);
    if (!this.ctx.db) return this;
    const [row] = await this.ctx.db
      .insert(jobRuns)
      .values({ startedAt: this.started, stage: this.stage, status: "running" })
      .returning({ id: jobRuns.id });
    this.id = row!.id;
    return this;
  }

  /** 运行中途把当前统计写进 job_runs（LLM 预算要读到并行任务已花的钱） */
  async flush() {
    if (!this.ctx.db || this.id === null) return;
    await this.ctx.db.update(jobRuns).set({ stats: this.stats }).where(eq(jobRuns.id, this.id));
  }

  error(msg: string) {
    this.errorCount++;
    if (this.errors.length < 200) this.errors.push({ at: new Date().toISOString(), msg });
    if (this.errorCount <= 20) log(this.stage, `错误：${msg}`);
  }

  async finish(status?: "ok" | "partial" | "failed") {
    const h = this.ctx.http.stats;
    const b = this.httpBase;
    const byStatus: Record<string, number> = {};
    for (const [k, v] of Object.entries(h.byStatus)) {
      const d = v - (b.byStatus[k] ?? 0);
      if (d) byStatus[k] = d;
    }
    const seconds = Math.round((Date.now() - this.started.getTime()) / 1000);
    this.stats = {
      ...this.stats,
      seconds,
      http: { requests: h.requests - b.requests, ok: h.ok - b.ok, failed: h.failed - b.failed, retries: h.retries - b.retries, byStatus },
      error_count: this.errorCount,
    };
    const final = status ?? (this.errorCount === 0 ? "ok" : "partial");
    log(this.stage, `结束 ${final}，${seconds}s，${JSON.stringify(this.stats)}`);
    if (this.ctx.db && this.id !== null) {
      await this.ctx.db
        .update(jobRuns)
        .set({ finishedAt: new Date(), status: final, stats: this.stats, errors: this.errors.length ? this.errors : null })
        .where(eq(jobRuns.id, this.id));
    }
    return final;
  }
}

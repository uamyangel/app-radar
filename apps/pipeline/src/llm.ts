/**
 * DeepSeek 客户端（OpenAI 兼容接口）。
 * - 关闭思考模式（思考 token 按输出计费，归类和摘要用不着）
 * - JSON 输出 + zod 校验：不合格重试一次，仍不合格就跳过这一批
 * - 按 usage 估算费用（区分缓存命中、高峰/非高峰），并执行每日预算
 */
import { SNAPSHOT_TZ, todayInTz } from "@app-radar/shared";
import { sql } from "@app-radar/shared/orm";
import type { z } from "zod";
import type { Ctx, Job } from "./context.ts";
import { sleep } from "./http.ts";

export class BudgetExceeded extends Error {}
/** DeepSeek 账户余额不足（HTTP 402）：继续调用没有意义，整个阶段立即停止 */
export class InsufficientBalance extends BudgetExceeded {}

type Usage = {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
};
export type LlmStats = {
  calls: number; failed: number; invalid_retries: number;
  prompt_tokens: number; cache_hit_tokens: number; completion_tokens: number; cost_usd: number;
};
type Message = { role: "system" | "user"; content: string };

/** 高峰时段：周一至周五 UTC 01:00–04:00、06:00–10:00（官方页面）；中国节假日按高峰算，宁可高估 */
export function isPeak(d = new Date()): boolean {
  const day = d.getUTCDay();
  const h = d.getUTCHours();
  return day >= 1 && day <= 5 && ((h >= 1 && h < 4) || (h >= 6 && h < 10));
}

export class Llm {
  readonly stats: LlmStats = { calls: 0, failed: 0, invalid_retries: 0, prompt_tokens: 0, cache_hit_tokens: 0, completion_tokens: 0, cost_usd: 0 };
  private othersToday = 0; // 今天其他任务（含并行的其他国家）已花的钱
  private refreshedAt = 0;
  private readonly budgetUsd: number;

  constructor(private ctx: Ctx, private job: Job, private apiKey: string) {
    this.budgetUsd = ctx.cfg.llm.daily_budget_cny / ctx.cfg.llm.usd_cny;
    job.stats.llm = this.stats;
  }

  /** 当天累计花费（美元）。其他任务的数每 30 秒从 job_runs 刷新一次 */
  async spentToday(): Promise<number> {
    if (this.ctx.db && Date.now() - this.refreshedAt > 30_000) {
      this.refreshedAt = Date.now();
      await this.job.flush(); // 先把自己的花费写进去，让并行的任务看得到
      const [r] = await this.ctx.db.execute<{ usd: string | null }>(sql`
        select sum((stats->'llm'->>'cost_usd')::numeric)::text usd from job_runs
        where (started_at at time zone ${SNAPSHOT_TZ})::date = ${todayInTz()}::date and id <> ${this.job.id ?? -1}`);
      this.othersToday = Number(r?.usd ?? 0);
    }
    return this.othersToday + this.stats.cost_usd;
  }

  /** 高峰时段价格翻倍：除非显式允许（--allow-peak），否则不调用 */
  peakBlocked(): boolean {
    return isPeak() && !this.ctx.allowPeak;
  }

  async budgetLeft(): Promise<boolean> {
    return (await this.spentToday()) < this.budgetUsd;
  }

  /** 发一次请求并按 schema 校验；预算用完抛 BudgetExceeded，最终失败返回 null */
  async json<S extends z.ZodTypeAny>(schema: S, messages: Message[], maxTokens: number): Promise<z.infer<S> | null> {
    if (this.peakBlocked()) throw new BudgetExceeded();
    if (!(await this.budgetLeft())) throw new BudgetExceeded();
    for (let attempt = 0; attempt < 2; attempt++) {
      const content = await this.call(messages, maxTokens);
      if (content === null) break;
      try {
        const r = schema.safeParse(JSON.parse(content));
        if (r.success) return r.data;
      } catch {
        /* JSON 不完整（比如输出被截断），按校验失败处理 */
      }
      this.stats.invalid_retries++;
    }
    this.stats.failed++;
    return null;
  }

  private async call(messages: Message[], maxTokens: number): Promise<string | null> {
    const body = JSON.stringify({
      model: this.ctx.cfg.llm.model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.2,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
    });
    for (let attempt = 0; attempt <= 4; attempt++) {
      if (attempt > 0) await sleep(2000 * 2 ** (attempt - 1) + Math.random() * 1000);
      try {
        const res = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(180_000),
        });
        if (res.status === 429 || res.status >= 500) continue;
        const d = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: Usage; error?: { message?: string } };
        if (res.status === 402) {
          this.job.error("DEEPSEEK_BALANCE_EMPTY：DeepSeek 账户余额不足，AI 处理已停止，充值后下次运行会自动补上");
          throw new InsufficientBalance();
        }
        if (!res.ok) {
          this.job.error(`DeepSeek HTTP ${res.status}：${d.error?.message?.slice(0, 200) ?? ""}`);
          return null; // 401/400 之类重试也没用
        }
        this.stats.calls++;
        if (d.usage) this.account(d.usage);
        return d.choices?.[0]?.message?.content ?? null;
      } catch (e) {
        if (attempt === 4) this.job.error(`DeepSeek 请求失败：${String(e).slice(0, 200)}`);
      }
    }
    return null;
  }

  private account(u: Usage) {
    const p = this.ctx.cfg.llm.pricing;
    const hit = u.prompt_cache_hit_tokens ?? 0;
    const miss = u.prompt_cache_miss_tokens ?? u.prompt_tokens - hit;
    const factor = isPeak() ? 1 : p.offpeak_factor;
    this.stats.prompt_tokens += u.prompt_tokens;
    this.stats.cache_hit_tokens += hit;
    this.stats.completion_tokens += u.completion_tokens;
    this.stats.cost_usd += ((hit * p.input_cache_hit + miss * p.input_cache_miss + u.completion_tokens * p.output) / 1e6) * factor;
  }
}

/** 并发执行，最多 n 个同时进行；fn 抛 BudgetExceeded 时停止派发新任务 */
export async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<{ stoppedByBudget: boolean }> {
  let i = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && i < items.length) {
      const x = items[i++]!;
      try {
        await fn(x);
      } catch (e) {
        if (e instanceof BudgetExceeded) stopped = true;
        else throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return { stoppedByBudget: stopped };
}

export function requireApiKey(): string {
  const k = process.env.DEEPSEEK_API_KEY;
  if (!k) throw new Error("缺少环境变量 DEEPSEEK_API_KEY");
  return k;
}

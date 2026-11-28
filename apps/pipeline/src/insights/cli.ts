/**
 * 本地 AI 流水线（手动运行，可多次运行：每一步只处理还没做的，中断后接着上次）。
 *
 *   pnpm insights status
 *   pnpm insights auto    # 定时运行用：检查电源和待办，有活才按 config.yaml 的 insights.auto 跑默认步骤
 *   pnpm insights run --provider claude|cursor|codex [--model 模型名]   # 不指定模型时用 config.yaml 的 insights.default_models [--model-extract …] [--model-assign …] [--model-cards …]
 *                     [--steps devs,scenes,events,checks,eventcards]   # 机会事件（默认，docs/opportunity-method.md）
 *                     [--steps devs,extract,scenes,assign,score,cards]  # 旧的需求卡片：需要时显式指定 [--country us,jp] [--genre 6007,6013]
 *                     [--max-calls 50] [--concurrency 3] [--redo-extract-since 2026-11-01]
 */
import { parseArgs } from "node:util";
import { COUNTRY_CODES, GENRES } from "@app-radar/shared";
import { loadConfig } from "@app-radar/shared/config";
import { createDb } from "@app-radar/shared/db";
import { sql } from "@app-radar/shared/orm";
import { runAssign, runRelabel } from "./assign.ts";
import { acquireSingleton, notify, pendingWork, powerOk, recordOutcome, startWatchdog } from "./auto.ts";
import { runDevs } from "./devs.ts";
import { runChecks, runEventCards, runEvents } from "./events.ts";
import { runCards } from "./cards.ts";
import { runExtract } from "./extract.ts";
import { PROVIDERS, type Provider, CURSOR_DEFAULT_MODEL, checkCursorModel } from "./providers.ts";
import { LockBusy, log, withLock, type RunCtx } from "./runner.ts";
import { runRebuild, runScenes } from "./scenes.ts";
import { runScore } from "./score.ts";

// 默认跑机会事件（docs/opportunity-method.md）。extract、assign、score、cards 是旧的需求卡片流程，提法仍是事件卡片的证据，需要时显式指定。
// relabel、rebuild 只在整理已有目录时显式指定
const STEPS = ["relabel", "devs", "extract", "scenes", "rebuild", "assign", "score", "cards", "events", "checks", "eventcards"] as const;
const DEFAULT_STEPS = ["devs", "scenes", "events", "checks", "eventcards"];

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      provider: { type: "string" },
      model: { type: "string" },
      "model-extract": { type: "string" }, // 每一步可单独指定模型，不指定就用 --model
      "model-assign": { type: "string" },
      "model-cards": { type: "string" },
      steps: { type: "string", default: DEFAULT_STEPS.join(",") },
      country: { type: "string" },
      genre: { type: "string" },
      "max-calls": { type: "string", default: "100" },
      concurrency: { type: "string", default: "1" },
      "redo-extract-since": { type: "string" },
      config: { type: "string", default: "config.yaml" },
    },
  });
  const cmd = positionals[0] ?? "status";
  const cfg = loadConfig(values.config);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("缺少环境变量 DATABASE_URL");

  const auto = cmd === "auto";
  if (auto) {
    if (!acquireSingleton()) { log("auto", "上一次自动运行还没结束，这次跳过"); return; }
    const power = powerOk(cfg.insights.auto.min_battery);
    if (!power.ok) { log("auto", `${power.desc}，低于 ${cfg.insights.auto.min_battery}%，这次不跑`); return; }
    values.provider ??= cfg.insights.auto.provider;
    values["max-calls"] = String(cfg.insights.auto.max_calls);
    values.concurrency = String(cfg.insights.auto.concurrency);
  }
  const { db, client } = createDb(url, { max: 2 });

  try {
    if (cmd === "status") return await status(db, cfg.insights.pipeline.window_days);
    if (cmd !== "run" && !auto) throw new Error(`未知命令 ${cmd}（可选：status、run、auto）`);
    if (auto) {
      const w = await pendingWork(db, cfg);
      if (!w.any) { log("auto", "没有待办，这次不跑"); return; }
      log("auto", `${w.events_stale ? "有新的评分数据，要重新找事件；" : ""}待写卡片的事件 ${w.cards}，待复核 ${w.checks}`);
      startWatchdog();
    }

    const provider = values.provider as Provider;
    if (!PROVIDERS.includes(provider)) throw new Error(`--provider 必须是 ${PROVIDERS.join(" / ")} 之一`);
    const steps = values.steps!.split(",").map((s) => s.trim());
    for (const s of steps) if (!(STEPS as readonly string[]).includes(s)) throw new Error(`未知步骤 ${s}（可选：${STEPS.join(",")}）`);
    const countries = values.country ? values.country.split(",") : (cfg.countries as string[]);
    for (const c of countries) if (!COUNTRY_CODES.includes(c as never)) throw new Error(`未知国家 ${c}`);
    const genres = values.genre ? values.genre.split(",").map(Number) : null;
    for (const g of genres ?? []) if (!cfg.insights.include_genres.includes(g)) throw new Error(`品类 ${g} 不在 insights.include_genres 白名单里`);

    // 每一步的模型：--model-<步骤> > --model > config.yaml 的 insights.default_models
    const defaults = cfg.insights.default_models[provider] ?? {};
    const modelFor = (step: "extract" | "assign" | "cards") => values[`model-${step}`] ?? values.model ?? defaults[step];
    // 开跑前就检查模型，避免跑到一半才发现
    if (provider === "cursor") for (const k of ["extract", "assign", "cards"] as const) checkCursorModel(modelFor(k));

    const ctx: RunCtx = {
      cfg, db, provider, model: values.model, countries, genres,
      maxCalls: Number(values["max-calls"]), concurrency: Math.max(1, Math.min(8, Number(values.concurrency))), calls: 0, costUsd: 0, stopped: null,
    };
    const models = (["extract", "assign", "cards"] as const).map((k) => `${k}=${modelFor(k) ?? (provider === "cursor" ? CURSOR_DEFAULT_MODEL : "默认")}`).join(" ");
    log("run", `订阅 ${provider}，模型 ${models}，步骤 ${steps.join(" → ")}，国家 ${countries.join(",")}${genres ? `，品类 ${genres.map((g) => GENRES[g]?.zh).join(",")}` : ""}，最多调用 ${ctx.maxCalls} 次`);

    await withLock(db, async () => {
      const use = (m: string | undefined) => { ctx.model = m; };
      if (steps.includes("relabel")) { use(modelFor("assign")); await runRelabel(ctx); }
      if (steps.includes("devs") && !ctx.stopped) { use(modelFor("extract")); await runDevs(ctx); }
      if (steps.includes("extract") && !ctx.stopped) { use(modelFor("extract")); await runExtract(ctx, { redoSince: values["redo-extract-since"] ?? null }); }
      // 标场景和归并是同一类工作（按目录归类），用归并的模型
      if (steps.includes("scenes") && !ctx.stopped) { use(modelFor("assign")); await runScenes(ctx); }
      if (steps.includes("rebuild") && !ctx.stopped) await runRebuild(ctx);
      if (steps.includes("assign") && !ctx.stopped) { use(modelFor("assign")); await runAssign(ctx); }
      // 打分不调用 AI：即使前面因额度停下，也重算一遍，让已完成的部分立刻反映到页面上
      if (steps.includes("score")) await runScore(ctx);
      if (steps.includes("cards") && !ctx.stopped) { use(modelFor("cards")); await runCards(ctx); }
      // 找事件和复核不调用 AI，额度停下也照跑
      if (steps.includes("events")) await runEvents(ctx);
      if (steps.includes("checks")) await runChecks(ctx);
      if (steps.includes("eventcards") && !ctx.stopped) { use(modelFor("cards")); await runEventCards(ctx); }
    });
    if (auto) {
      recordOutcome(true, "");
      const [c] = await db.execute<{ follow: number; watch: number }>(sql`
        select count(*) filter (where card->>'verdict' = 'follow')::int follow, count(*) filter (where card->>'verdict' = 'watch')::int watch from opportunity_events`);
      if (ctx.calls > 0) notify(`自动分析完成：调用 ${ctx.calls} 次，值得跟进 ${c?.follow} 个、观察 ${c?.watch} 个${ctx.stopped ? `（提前停止：${ctx.stopped.slice(0, 60)}，下次接着做）` : ""}`);
    }
    log("run", `结束：调用 ${ctx.calls} 次${ctx.costUsd ? `，按 API 价折算约 $${ctx.costUsd.toFixed(3)}（订阅内不额外扣费）` : ""}${ctx.stopped ? `；提前停止：${ctx.stopped}。再次运行会接着做` : ""}`);
  } finally {
    await client.end();
  }
}

async function status(db: ReturnType<typeof createDb>["db"], windowDays: number) {
  const [r] = await db.execute<Record<string, number>>(sql`
    select
      (select count(*) from review_extractions)::int extracted,
      (select count(*) from review_statements)::int statements,
      (select count(*) from review_statements where need_id is null)::int unassigned,
      (select count(*) from needs where merged_into is null and not retired)::int needs,
      (select count(*) from needs where generic and not retired)::int generic,
      (select count(*) from scenes)::int scenes,
      (select count(*) from app_scenes)::int labeled,
      (select count(*) from needs where scope = 'app' and not retired)::int app_only,
      (select count(*) from need_metrics where tier = 'main')::int main,
      (select count(*) from opportunity_cards)::int cards,
      (select count(*) from opportunity_cards where card->>'verdict' = 'build')::int build,
      (select count(*) from opportunity_cards where card->>'verdict' = 'trend')::int trend`);
  console.log(`近 ${windowDays} 天的数据：
  已提取评论 ${r?.extracted}，提法 ${r?.statements}（未归并 ${r?.unassigned}）
  场景 ${r?.scenes}（已标场景的 App ${r?.labeled}）
  需求 ${r?.needs}（其中通用抱怨 ${r?.generic}，单个 App 的问题 ${r?.app_only}），上主列表的（需求 × 国家）${r?.main}
  机会卡片 ${r?.cards}：可做 ${r?.build}，趋势 ${r?.trend}，其余不成立`);
  const [ev] = await db.execute<Record<string, number>>(sql`
    select count(*)::int total, count(*) filter (where card is not null)::int carded,
           count(*) filter (where card->>'verdict' = 'follow')::int follow, count(*) filter (where card->>'verdict' = 'watch')::int watch,
           count(*) filter (where status = 'skip')::int skip, count(*) filter (where status = 'held')::int held, count(*) filter (where status = 'faded')::int faded
    from opportunity_events`);
  console.log(`机会事件 ${ev?.total}（已写卡片 ${ev?.carded}）：值得跟进 ${ev?.follow}，观察 ${ev?.watch}，噪声 ${ev?.skip}；复核后还在涨 ${ev?.held}，已停涨 ${ev?.faded}`);
  // 反馈汇总：比较「有价值」和「没价值」两组在各分项上的平均值，差距越大说明这个分项越能区分你的判断
  const fb = await db.execute<{ verdict: string; n: number; evidence: number; market: number; gap: number; feasibility: number; mentions: number }>(sql`
    select verdict, count(*)::int n,
      round(avg((metrics_snapshot->>'evidence')::numeric), 2)::float8 evidence, round(avg((metrics_snapshot->>'market')::numeric), 2)::float8 market,
      round(avg((metrics_snapshot->>'gap')::numeric), 2)::float8 gap, round(avg((metrics_snapshot->>'feasibility')::numeric), 2)::float8 feasibility,
      round(avg((metrics_snapshot->>'mentions')::numeric), 1)::float8 mentions
    from feedback group by 1 order by 1 desc`);
  if (fb.length) {
    console.log("你的反馈（各分项平均值；两组差距大的分项最能区分你的判断，可以加大权重）：");
    for (const f of fb) console.log(`  ${f.verdict === "up" ? "有价值" : "没价值"} ${f.n} 条：证据 ${f.evidence}  市场 ${f.market}  缺口 ${f.gap}  可行 ${f.feasibility}  平均提及 ${f.mentions}`);
    if (fb.reduce((a, f) => a + f.n, 0) < 20) console.log("  （少于 20 条，先多标一些再据此调权重）");
  }
  const runs = await db.execute<{ stage: string; status: string; at: string; stats: Record<string, unknown> }>(sql`
    select stage, status, to_char(finished_at at time zone 'Asia/Shanghai', 'MM-DD HH24:MI') at, stats
    from job_runs where stage like 'insights:%' order by id desc limit 8`);
  if (runs.length) {
    console.log("最近的运行：");
    for (const x of runs) console.log(`  ${x.at} ${x.stage} ${x.status} ${x.stats.provider}/${x.stats.model}${x.stats.stopped ? ` 停止原因：${x.stats.stopped}` : ""}`);
  }
}

main().catch((e) => {
  // drizzle 的查询错误：message 是整条 SQL 加参数（可能几百 KB），数据库给的原因在 cause 里
  const cause = e instanceof Error && e.cause instanceof Error ? `：${e.cause.message}` : "";
  const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300) + cause;
  // 定时运行碰上手动运行（比如长时间的重建）：这次跳过，不算失败
  if (e instanceof LockBusy && process.argv.includes("auto")) { log("auto", `${msg}；这次跳过`); process.exit(0); }
  console.error(msg);
  if (process.argv.includes("auto")) recordOutcome(false, msg);
  process.exit(1);
});

/**
 * 本地 AI 流水线（手动运行，可多次运行：每一步只处理还没做的，中断后接着上次）。
 *
 *   pnpm insights status
 *   pnpm insights run --provider claude|cursor|codex [--model 模型名]
 *                     [--steps extract,assign,score,cards] [--country us,jp] [--genre 6007,6013]
 *                     [--max-calls 50] [--redo-extract-since 2026-11-01]
 */
import { parseArgs } from "node:util";
import { COUNTRY_CODES, GENRES } from "@app-radar/shared";
import { loadConfig } from "@app-radar/shared/config";
import { createDb } from "@app-radar/shared/db";
import { sql } from "@app-radar/shared/orm";
import { runAssign } from "./assign.ts";
import { runCards } from "./cards.ts";
import { runExtract } from "./extract.ts";
import { PROVIDERS, type Provider } from "./providers.ts";
import { log, withLock, type RunCtx } from "./runner.ts";
import { runScore } from "./score.ts";

const STEPS = ["extract", "assign", "score", "cards"] as const;

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      provider: { type: "string" },
      model: { type: "string" },
      steps: { type: "string", default: STEPS.join(",") },
      country: { type: "string" },
      genre: { type: "string" },
      "max-calls": { type: "string", default: "100" },
      "redo-extract-since": { type: "string" },
      config: { type: "string", default: "config.yaml" },
    },
  });
  const cmd = positionals[0] ?? "status";
  const cfg = loadConfig(values.config);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("缺少环境变量 DATABASE_URL");
  const { db, client } = createDb(url, { max: 2 });

  try {
    if (cmd === "status") return await status(db, cfg.insights.pipeline.window_days);
    if (cmd !== "run") throw new Error(`未知命令 ${cmd}（可选：status、run）`);

    const provider = values.provider as Provider;
    if (!PROVIDERS.includes(provider)) throw new Error(`--provider 必须是 ${PROVIDERS.join(" / ")} 之一`);
    const steps = values.steps!.split(",").map((s) => s.trim());
    for (const s of steps) if (!(STEPS as readonly string[]).includes(s)) throw new Error(`未知步骤 ${s}（可选：${STEPS.join(",")}）`);
    const countries = values.country ? values.country.split(",") : (cfg.countries as string[]);
    for (const c of countries) if (!COUNTRY_CODES.includes(c as never)) throw new Error(`未知国家 ${c}`);
    const genres = values.genre ? values.genre.split(",").map(Number) : null;
    for (const g of genres ?? []) if (!cfg.insights.include_genres.includes(g)) throw new Error(`品类 ${g} 不在 insights.include_genres 白名单里`);

    const ctx: RunCtx = {
      cfg, db, provider, model: values.model, countries, genres,
      maxCalls: Number(values["max-calls"]), calls: 0, costUsd: 0, stopped: null,
    };
    log("run", `订阅 ${provider}，模型 ${values.model ?? "(默认)"}，步骤 ${steps.join(" → ")}，国家 ${countries.join(",")}${genres ? `，品类 ${genres.map((g) => GENRES[g]?.zh).join(",")}` : ""}，最多调用 ${ctx.maxCalls} 次`);

    await withLock(db, async () => {
      if (steps.includes("extract")) await runExtract(ctx, { redoSince: values["redo-extract-since"] ?? null });
      if (steps.includes("assign") && !ctx.stopped) await runAssign(ctx);
      // 打分不调用 AI：即使前面因额度停下，也重算一遍，让已完成的部分立刻反映到页面上
      if (steps.includes("score")) await runScore(ctx);
      if (steps.includes("cards") && !ctx.stopped) await runCards(ctx);
    });
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
      (select count(*) from needs where merged_into is null)::int needs,
      (select count(*) from need_metrics where tier = 'main')::int main,
      (select count(*) from opportunity_cards)::int cards`);
  console.log(`近 ${windowDays} 天的数据：
  已提取评论 ${r?.extracted}，提法 ${r?.statements}（未归并 ${r?.unassigned}）
  需求 ${r?.needs}，上主列表的（需求 × 国家）${r?.main}，机会卡片 ${r?.cards}`);
  const runs = await db.execute<{ stage: string; status: string; at: string; stats: Record<string, unknown> }>(sql`
    select stage, status, to_char(finished_at at time zone 'Asia/Shanghai', 'MM-DD HH24:MI') at, stats
    from job_runs where stage like 'insights:%' order by id desc limit 8`);
  if (runs.length) {
    console.log("最近的运行：");
    for (const x of runs) console.log(`  ${x.at} ${x.stage} ${x.status} ${x.stats.provider}/${x.stats.model}${x.stats.stopped ? ` 停止原因：${x.stats.stopped}` : ""}`);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

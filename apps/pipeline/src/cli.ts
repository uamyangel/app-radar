/**
 * 用法：
 *   pnpm pipeline run [--stage charts|apps|reviews|classify|summaries|briefs|daily] [--country us,jp] [--genre 0,6007]
 *                     [--chart free] [--dry-run] [--max-minutes 330] [--limit N]
 *   pnpm pipeline report      打印各表行数、体积和最近的 job_runs
 */
import { parseArgs } from "node:util";
import { CHART_TYPES, COUNTRY_CODES, todayInTz, type ChartType, type Country } from "@app-radar/shared";
import { loadConfig } from "@app-radar/shared/config";
import { createDb } from "@app-radar/shared/db";
import type { Ctx } from "./context.ts";
import { HttpClient } from "./http.ts";
import { runApps } from "./stages/apps.ts";
import { runCharts } from "./stages/charts.ts";
import { runReviews } from "./stages/reviews.ts";
import { runClassify } from "./stages/classify.ts";
import { runSummaries } from "./stages/summaries.ts";
import { runBriefs } from "./stages/briefs.ts";
import { report } from "./report.ts";

const STAGES = { charts: runCharts, apps: runApps, reviews: runReviews, classify: runClassify, summaries: runSummaries, briefs: runBriefs } as const;
type Stage = keyof typeof STAGES;
// 摘要和简报每天都跑：本周已生成的会跳过，所以实际是周一生成，预算不够时后面几天补完
const DAILY: Stage[] = ["charts", "apps", "reviews", "classify", "summaries", "briefs"];

function list<T extends string | number>(raw: string | undefined, all: readonly T[], parse: (s: string) => T, name: string): T[] {
  if (!raw) return [...all];
  const xs = raw.split(",").map((s) => parse(s.trim()));
  const bad = xs.filter((x) => !all.includes(x));
  if (bad.length) throw new Error(`--${name} 不在配置范围内：${bad.join(",")}（可选：${all.join(",")}）`);
  return xs;
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      stage: { type: "string", default: "daily" },
      country: { type: "string" },
      genre: { type: "string" },
      chart: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "max-minutes": { type: "string", default: "330" },
      limit: { type: "string" },
      config: { type: "string", default: "config.yaml" },
    },
  });
  const cmd = positionals[0] ?? "run";
  const cfg = loadConfig(values.config);
  const dryRun = values["dry-run"];
  const url = process.env.DATABASE_URL;

  if (cmd === "report") {
    if (!url) throw new Error("缺少环境变量 DATABASE_URL");
    const { db, client } = createDb(url);
    try { await report(db); } finally { await client.end(); }
    return;
  }
  if (cmd !== "run") throw new Error(`未知命令 ${cmd}`);

  const stages: Stage[] = values.stage === "daily" ? DAILY : [values.stage as Stage];
  for (const st of stages) if (!(st in STAGES)) throw new Error(`未知阶段 ${st}（可选：${Object.keys(STAGES).join(",")},daily）`);
  if (!dryRun && !url) throw new Error("缺少环境变量 DATABASE_URL（或使用 --dry-run）");

  const conn = !dryRun && url ? createDb(url) : null;
  const ctx: Ctx = {
    cfg,
    db: conn?.db ?? null,
    http: new HttpClient({
      defaultIntervalMs: Math.ceil(1000 / cfg.http.requests_per_second),
      maxRetries: cfg.http.max_retries,
      timeoutMs: cfg.http.timeout_ms,
    }),
    date: todayInTz(),
    countries: list(values.country, cfg.countries as Country[], (s) => s as Country, "country").filter((c) => COUNTRY_CODES.includes(c)),
    genres: list(values.genre, cfg.genres, Number, "genre"),
    charts: list(values.chart, cfg.charts as ChartType[], (s) => s as ChartType, "chart").filter((c) => CHART_TYPES.includes(c)),
    dryRun,
    deadline: Date.now() + Number(values["max-minutes"]) * 60_000,
    limit: values.limit ? Number(values.limit) : null,
    mem: {},
  };

  let failed = false;
  try {
    for (const st of stages) {
      try {
        const status = await STAGES[st](ctx);
        if (status === "failed") failed = true;
      } catch (e) {
        // 阶段内部没兜住的异常：记进 job_runs 并标记失败，继续跑后面的阶段（各阶段相互独立、幂等）
        failed = true;
        const job = ctx.current;
        if (job && job.stage === st) {
          job.error(`未处理的异常：${(e instanceof Error ? e.message : String(e)).slice(0, 500)}`);
          await job.finish("failed").catch(() => {});
        } else {
          console.error(e);
        }
      }
    }
  } finally {
    await conn?.client.end();
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

import { chartSnapshots } from "@app-radar/shared";
import { sql } from "drizzle-orm";
import {
  legacyChartUrl, marketingChartUrl, MARKETING_CHARTS, parseLegacyChart, parseMarketingChart, type ChartEntry,
} from "../apple.ts";
import { Job, log, type Ctx } from "../context.ts";

/**
 * 榜单阶段：旧版 RSS 为主；失败时总榜免费/付费降级到 Marketing RSS，其余组合无可替代，记错误。
 * 幂等：按 (date, country, genre, chart) upsert。
 */
export async function runCharts(ctx: Ctx) {
  const job = await new Job(ctx, "charts").start();
  const s = { attempted: 0, saved: 0, legacy_failed: 0, fallback_marketing: 0, empty: 0, unavailable: 0 };
  ctx.mem.snapshots = [];

  for (const cc of ctx.countries) {
    for (const genre of ctx.genres) {
      for (const chart of ctx.charts) {
        if (Date.now() > ctx.deadline) { job.error("超过时间上限，提前结束"); break; }
        s.attempted++;
        const key = `${cc}/${genre}/${chart}`;
        let entries: ChartEntry[] | null = null;
        let source: "legacy" | "marketing" = "legacy";

        const r = await ctx.http.get(legacyChartUrl(cc, genre, chart, ctx.cfg.chart_limit));
        if (r.ok) {
          try { entries = parseLegacyChart(r.text); } catch (e) { job.error(`${key} 旧版 RSS 解析失败：${String(e).slice(0, 200)}`); }
        } else {
          job.error(`${key} 旧版 RSS HTTP ${r.status}`);
        }

        if (!entries) {
          s.legacy_failed++;
          if (genre === 0 && MARKETING_CHARTS[chart]) {
            const m = await ctx.http.get(marketingChartUrl(cc, chart, ctx.cfg.chart_limit), { maxRetries: 6 });
            if (m.ok) {
              try {
                entries = parseMarketingChart(m.text);
                source = "marketing";
                s.fallback_marketing++;
                log("charts", `⚠️ ${key} 已降级到 Marketing RSS`);
              } catch (e) { job.error(`${key} Marketing RSS 解析失败：${String(e).slice(0, 200)}`); }
            } else {
              job.error(`${key} Marketing RSS HTTP ${m.status}`);
            }
          }
        }
        if (!entries) { s.unavailable++; continue; }
        if (entries.length === 0) s.empty++; // 例如 cn 新闻榜，Apple 本身就是空的

        const appIds = [...new Set(entries.map((e) => e.appId))];
        ctx.mem.snapshots.push({ country: cc, genreId: genre, chartType: chart, appIds });
        if (ctx.db) {
          await ctx.db
            .insert(chartSnapshots)
            .values({ snapshotDate: ctx.date, country: cc, genreId: genre, chartType: chart, appIds, source, fetchedAt: new Date() })
            .onConflictDoUpdate({
              target: [chartSnapshots.snapshotDate, chartSnapshots.country, chartSnapshots.genreId, chartSnapshots.chartType],
              set: { appIds: sql`excluded.app_ids`, source: sql`excluded.source`, fetchedAt: sql`excluded.fetched_at` },
            });
        }
        s.saved++;
      }
    }
    log("charts", `${cc} 完成，累计保存 ${s.saved}/${s.attempted}`);
  }

  // 旧版接口整体失效的告警：大面积失败时在日志里明确标出
  if (s.attempted > 0 && s.legacy_failed / s.attempted > 0.5) {
    job.error(`LEGACY_RSS_DOWN：旧版 RSS ${s.legacy_failed}/${s.attempted} 失败，品类榜和畅销榜无法获取`);
  }
  job.stats = s;
  return job.finish(s.saved === 0 ? "failed" : undefined);
}

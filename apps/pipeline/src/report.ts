import type { Db } from "@app-radar/shared/db";
import { sql } from "drizzle-orm";

/** 各表行数和体积、最近 job_runs、当天评论来源分布 */
export async function report(db: Db) {
  const tables = await db.execute<{ table: string; rows: string; size: string; bytes: string }>(sql`
    select c.relname as table, c.reltuples::bigint::text as rows,
           pg_size_pretty(pg_total_relation_size(c.oid)) as size, pg_total_relation_size(c.oid)::text as bytes
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname not like '\\_\\_%'
    order by pg_total_relation_size(c.oid) desc`);
  // reltuples 是估计值，小表用精确计数
  const exact = await db.execute<{ t: string; n: string }>(sql`
    select 'apps' t, count(*)::text n from apps union all
    select 'chart_snapshots', count(*)::text from chart_snapshots union all
    select 'app_rating_daily', count(*)::text from app_rating_daily union all
    select 'reviews', count(*)::text from reviews union all
    select 'review_crawl_state', count(*)::text from review_crawl_state union all
    select 'job_runs', count(*)::text from job_runs`);
  const n = Object.fromEntries(exact.map((r) => [r.t, r.n]));
  console.log("\n表\t行数\t体积");
  let total = 0;
  for (const t of tables) {
    total += Number(t.bytes);
    console.log(`${t.table}\t${n[t.table] ?? t.rows}\t${t.size}`);
  }
  console.log(`合计\t\t${(total / 1024 / 1024).toFixed(1)} MB`);

  const jobs = await db.execute<{ id: string; stage: string; status: string; started_at: string; seconds: string; stats: unknown }>(sql`
    select id, stage, status, started_at, extract(epoch from finished_at - started_at)::int as seconds, stats
    from job_runs order by id desc limit 6`);
  console.log("\n最近任务：");
  for (const j of [...jobs].reverse()) console.log(`#${j.id} ${j.stage} ${j.status} ${j.seconds ?? "-"}s ${JSON.stringify(j.stats)}`);

  const src = await db.execute<{ country: string; source: string; n: string; apps: string; lang: string }>(sql`
    select country, source, count(*)::text n, count(distinct app_id)::text apps,
           string_agg(distinct lang, ',') lang
    from reviews group by 1, 2 order by 1, 2`);
  if (src.length) {
    console.log("\n评论分布：");
    for (const r of src) console.log(`${r.country} ${r.source}: ${r.n} 条，${r.apps} 个 App，语言 ${r.lang}`);
  }
}

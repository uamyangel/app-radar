import { sql } from "@app-radar/shared/orm";
import { Job, log, type Ctx } from "../context.ts";
import { syncDevelopers } from "../insights.ts";
import { pgIntArray } from "./scope.ts";

/**
 * 市场信号（不需要 AI，docs/insights-design.md 第 4、4.2 节）：每天给当天在榜的每个 App 算一行。
 * 标签：陈旧在榜、付费利基、口碑差、口碑下滑、新品上榜、小App快速上升、大公司、疑似刷分。
 * 付费利基只看畅销榜（用户少但在赚钱）；只上付费榜的不算（付费 App 普遍评分数少，筛不出东西）。
 * 「产品弱」用文字评论满意度判断，并和同品类中位数比较；官方评分被弹窗好评系统性拉高，不直接用。
 */
export async function runSignals(ctx: Ctx) {
  const job = await new Job(ctx, "signals").start();
  if (!ctx.db) { job.error("信号计算需要读库，dry-run 下跳过"); return job.finish(); }
  await syncDevelopers(ctx);
  const g = ctx.cfg.insights.signals;
  const include = pgIntArray(ctx.cfg.insights.include_genres);
  const s: Record<string, number> = {};

  for (const cc of ctx.countries) {
    const rows = await ctx.db.execute<{ n: number }>(sql`
      with
      snap as (select genre_id, chart_type, app_ids from chart_snapshots where country = ${cc} and snapshot_date = ${ctx.date}),
      ranks as (select u.app_id, s.genre_id, s.chart_type, u.rank::int rank from snap s, unnest(s.app_ids) with ordinality u(app_id, rank)),
      best as (
        select app_id, min(rank) best_rank,
               (array_agg(genre_id || ':' || chart_type order by rank))[1] best_chart,
               bool_or(chart_type = 'paid') on_paid, bool_or(chart_type = 'grossing') on_grossing,
               min(rank) filter (where chart_type = 'grossing') grossing_rank
        from ranks group by app_id),
      -- 7 天内最早一天的最好名次（算名次变化）；昨天的最好名次（判断评分暴涨时名次有没有动）
      early_day as (select min(snapshot_date) d from chart_snapshots where country = ${cc} and snapshot_date between ${ctx.date}::date - 7 and ${ctx.date}::date - 1),
      early as (
        select u.app_id, min(u.rank)::int r from chart_snapshots s, unnest(s.app_ids) with ordinality u(app_id, rank)
        where s.country = ${cc} and s.snapshot_date = (select d from early_day) group by 1),
      yday as (
        select u.app_id, min(u.rank)::int r from chart_snapshots s, unnest(s.app_ids) with ordinality u(app_id, rank)
        where s.country = ${cc} and s.snapshot_date = ${ctx.date}::date - 1 group by 1),
      -- 评分数：14 天内最早一天（算增速）和昨天（判断暴涨）
      rc_then as (
        select distinct on (app_id) app_id, snapshot_date d, rating_count from app_rating_daily
        where country = ${cc} and snapshot_date between ${ctx.date}::date - 14 and ${ctx.date}::date - 1 and rating_count is not null
        order by app_id, snapshot_date),
      rc_yday as (select app_id, rating_count from app_rating_daily where country = ${cc} and snapshot_date = ${ctx.date}::date - 1),
      -- 文字评论满意度
      rev as (
        select app_id,
          count(*) n90, avg(rating) avg90, avg((rating <= 3)::int) low90,
          count(*) filter (where reviewed_at > now() - interval '30 days') n30,
          avg(rating) filter (where reviewed_at > now() - interval '30 days') avg30,
          count(*) filter (where reviewed_at <= now() - interval '30 days') nprev,
          avg(rating) filter (where reviewed_at <= now() - interval '30 days') avgprev
        from reviews where country = ${cc} and reviewed_at > now() - interval '90 days' group by app_id),
      -- 7 天内同一 App 出现 ≥3 条完全相同的五星长评（≥20 字）。「great app」这类口头禅很短、各 App 都有，不算
      burst as (
        select distinct app_id from reviews
        where country = ${cc} and rating = 5 and reviewed_at > now() - interval '7 days' and char_length(btrim(content)) >= 20
        group by app_id, lower(btrim(content)) having count(*) >= 3),
      base as (
        select b.*, a.primary_genre_id genre, a.rating_count, a.version_date, a.release_date,
               coalesce(d.type, 'normal') dev_type,
               r.n90, r.avg90, r.low90, r.n30, r.avg30, r.nprev, r.avgprev,
               e.r early_rank, y.r yday_rank, t.d then_d, t.rating_count then_rc, ry.rating_count yday_rc,
               (b.app_id in (select app_id from burst)) is_burst
        from best b
        join apps a on a.app_id = b.app_id and a.country = ${cc}
        left join developers d on d.developer_id = a.developer_id
        left join rev r on r.app_id = b.app_id
        left join early e on e.app_id = b.app_id
        left join yday y on y.app_id = b.app_id
        left join rc_then t on t.app_id = b.app_id
        left join rc_yday ry on ry.app_id = b.app_id),
      med as (select genre, percentile_cont(0.5) within group (order by avg90) m from base where n90 >= ${g.weak_min_reviews} group by genre),
      calc as (
        select base.*, med.m genre_median,
          (${ctx.date}::date - version_date::date) days_since_update,
          array_remove(array[
            case when yday_rc is not null and rating_count - yday_rc > greatest(500, yday_rc * 0.05)
                  and coalesce(yday_rank - best_rank, 0) < 10 then '评分数单日暴涨但名次没动' end,
            case when is_burst then '短时间内大量雷同五星评论' end
          ], null) susp
        from base left join med using (genre))
      insert into app_signals (
        app_id, country, snapshot_date, dev_type, in_scope, best_rank, best_chart, on_paid, on_grossing,
        days_since_update, rating_count, rating_velocity, rank_delta_7d,
        review_n_90d, review_avg_90d, low_share_90d, genre_review_median, review_avg_30d, review_avg_prev, suspicious, tags)
      select app_id, ${cc}, ${ctx.date}, dev_type,
        (genre = any(${include}::int[]) and dev_type in ('major', 'normal')),
        best_rank, best_chart, on_paid, on_grossing, days_since_update, rating_count,
        case when then_rc is not null and ${ctx.date}::date > then_d then round((rating_count - then_rc)::numeric / (${ctx.date}::date - then_d), 2) end,
        early_rank - best_rank,
        n90, round(avg90, 2), round(low90, 3), round(genre_median::numeric, 2),
        case when n30 >= ${g.decline_min_reviews} then round(avg30, 2) end,
        case when nprev >= ${g.decline_min_reviews} then round(avgprev, 2) end,
        nullif(susp, '{}'),
        array_remove(array[
          case when days_since_update >= ${g.stale_days} and best_rank <= ${g.stale_max_rank} then '陈旧在榜' end,
          case when grossing_rank <= ${g.paid_niche_max_rank} and rating_count < ${g.paid_niche_max_ratings} then '付费利基' end,
          case when n90 >= ${g.weak_min_reviews} and avg90 <= genre_median - ${g.weak_below_median} then '口碑差' end,
          case when n30 >= ${g.decline_min_reviews} and nprev >= ${g.decline_min_reviews} and avg30 <= avgprev - ${g.decline_drop} then '口碑下滑' end,
          case when release_date > ${ctx.date}::date - ${g.new_release_days}::int and best_rank <= ${g.new_release_max_rank} then '新品上榜' end,
          case when rating_count < ${g.rising_max_ratings} and early_rank - best_rank >= ${g.rising_rank_delta} and best_rank <= ${g.rising_max_rank} then '小App快速上升' end,
          case when dev_type = 'major' then '大公司' end,
          case when cardinality(susp) > 0 then '疑似刷分' end
        ], null)
      from calc
      on conflict (app_id, country, snapshot_date) do update set
        dev_type = excluded.dev_type, in_scope = excluded.in_scope, best_rank = excluded.best_rank, best_chart = excluded.best_chart,
        on_paid = excluded.on_paid, on_grossing = excluded.on_grossing, days_since_update = excluded.days_since_update,
        rating_count = excluded.rating_count, rating_velocity = excluded.rating_velocity, rank_delta_7d = excluded.rank_delta_7d,
        review_n_90d = excluded.review_n_90d, review_avg_90d = excluded.review_avg_90d, low_share_90d = excluded.low_share_90d,
        genre_review_median = excluded.genre_review_median, review_avg_30d = excluded.review_avg_30d,
        review_avg_prev = excluded.review_avg_prev, suspicious = excluded.suspicious, tags = excluded.tags
      returning 1 n`);
    s[`${cc}_apps`] = rows.length;
    const tagCounts = await ctx.db.execute<{ t: string; n: number }>(sql`
      select t, count(*)::int n from app_signals, unnest(tags) t
      where country = ${cc} and snapshot_date = ${ctx.date} and in_scope group by 1 order by 2 desc`);
    for (const r of tagCounts) s[`${cc}_${r.t}`] = r.n;
    log("signals", `${cc}：${rows.length} 个 App；白名单内的标签 ${tagCounts.map((r) => `${r.t} ${r.n}`).join("、")}`);
  }
  await ctx.db.execute(sql`delete from app_signals where snapshot_date < ${ctx.date}::date - ${g.keep_days}::int`);
  job.stats = s;
  return job.finish();
}

import { sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { api, Country } from "../_lib/api.ts";
import type { OppRow, OppsResp } from "../_lib/types.ts";

const Q = z.object({ country: Country, genre: z.coerce.number().int().optional(), tier: z.enum(["main", "watch"]).default("main") });

/** 机会列表：按排序分从高到低；有卡片的带卡片 */
export const onRequestGet = api(Q, async (q, db): Promise<OppsResp> => {
  const g = q.genre ? sql`and n.genre_id = ${q.genre}` : sql``;
  const [counts] = await db.execute<{ main: number; watch: number }>(sql`
    select count(*) filter (where m.tier = 'main')::int main, count(*) filter (where m.tier = 'watch')::int watch
    from need_metrics m join needs n on n.id = m.need_id where m.country = ${q.country} ${g}`);
  const rows = await db.execute<OppRow & { host_apps: OppRow["hostApps"] }>(sql`
    select m.need_id::float8 "needId", n.genre_id "genreId", n.title "needTitle", n.kind,
      jsonb_build_object(
        'mentions', m.mentions, 'apps', m.apps, 'developers', m.developers, 'weeksActive', m.weeks_active,
        'churnN', m.churn_n, 'payN', m.pay_n, 'oneStarShare', m.one_star_share, 'prevalenceLb', m.prevalence_lb,
        'bestHostRank', m.best_host_rank, 'hostOnGrossing', m.host_on_grossing, 'hostStale', m.host_stale, 'hostWeak', m.host_weak,
        'allHostsMajor', m.all_hosts_major, 'evidence', m.evidence, 'market', m.market, 'gap', m.gap,
        'feasibility', m.feasibility, 'score', m.score, 'tier', m.tier) metrics,
      (select coalesce(jsonb_agg(h || jsonb_build_object('iconUrl', a.icon_url)), '[]')
         from jsonb_array_elements(m.host_apps) with ordinality h(h, i)
         left join apps a on a.app_id = (h->>'appId')::bigint and a.country = m.country
         where i <= 5) "hostApps",
      c.card, c.model "cardModel"
    from need_metrics m join needs n on n.id = m.need_id
    left join opportunity_cards c on c.need_id = m.need_id and c.country = m.country
    where m.country = ${q.country} and m.tier = ${q.tier} ${g}
    order by m.score desc limit 200`);
  return { counts: counts ?? { main: 0, watch: 0 }, rows: [...rows] };
});

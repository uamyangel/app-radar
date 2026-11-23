/**
 * S5 机会卡片：每个国家 × 品类，给排序分最高、达到主列表门槛的需求写卡片。
 * 证据增长超过 card_rewrite_growth 或提示词版本变了才重写，否则跳过（多次运行不重复）。
 */
import { GENRES, opportunityCards } from "@app-radar/shared";
import { sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { pgTextArray } from "../stages/scope.ts";
import { KINDS } from "./extract.ts";
import { ask, log, recordStep, type RunCtx } from "./runner.ts";

export const CARD_VERSION = "card-v2"; // v2：要求证据用自然语言写，不出现内部字段名

export const CardSchema = z.object({
  title: z.string().min(4).transform((t) => t.trim().slice(0, 50)), // 一句话机会
  who: z.string(), // 谁有这个需求
  problem: z.string(), // 具体遇到什么问题
  evidence: z.string(), // 证据摘要（只用程序给的数字）
  existing: z.array(z.object({ app_id: z.coerce.number(), gap: z.string() })).catch([]), // 现有产品哪里没做好
  indie_fit: z.string(), // 个人能不能做、为什么
  complexity: z.string().transform((c) => (["小", "中", "大"].includes(c.trim()) ? c.trim() : c.includes("大") ? "大" : c.includes("小") ? "小" : "中")),
  risks: z.array(z.string()).catch([]),
  angle: z.string(), // 切入角度
  monetization: z.string(), // 可能的收费方式
  quote_ids: z.array(z.coerce.string()).catch([]), // 最能说明问题的评论 id
});

const SYSTEM = `你是帮独立开发者找产品机会的分析师。给你一个从 App Store 评论里归纳出的用户需求，以及程序算好的证据和承载这个需求的 App，写一张「机会卡片」。

只输出 JSON（简体中文）：
{
  "title": "一句话说清机会，25 字以内，例如「买断制、无广告的极简血压记录」",
  "who": "谁有这个需求（具体人群和场景）",
  "problem": "他们遇到的具体问题",
  "evidence": "证据摘要：用自然语言引用输入里的数字，例如「14 条评论、来自 2 个 App，持续 10 周；在主要承载 App 的评论里至少约 3 成提到」。不要自己编数字，不要出现 pay_n、prevalence_lb、score 这类字段名或打分数值",
  "existing": [{"app_id": 0, "gap": "这个 App 在这件事上哪里没做好"}],
  "indie_fit": "一个人能不能做、为什么：技术难度、是否依赖网络效应/内容版权/资质/硬件、巨头会不会很快补上",
  "complexity": "小 / 中 / 大（一个人做出可用版本的工作量）",
  "risks": ["主要风险，2–4 条"],
  "angle": "最可行的切入角度（差异化在哪）",
  "monetization": "可能的收费方式",
  "quote_ids": ["2–4 个最能说明问题的评论 id"]
}

要求：只依据输入，不编造；existing 和 quote_ids 只能用输入里出现过的 id；如果判断个人做不了，indie_fit 里直接说明，不要硬凑。`;

export async function runCards(ctx: RunCtx) {
  const started = new Date();
  const p = ctx.cfg.insights.pipeline;
  const s = { candidates: 0, written: 0, skipped_fresh: 0, failed: 0 };

  const cands = await ctx.db.execute<{
    need_id: number; country: string; genre_id: number; title: string; description: string | null; kind: string;
    m: Record<string, unknown>; card_mentions: number | null; card_version: string | null;
  }>(sql`
    with ranked as (
      select m.*, n.genre_id, n.title, n.description, n.kind,
             row_number() over (partition by m.country, n.genre_id order by m.score desc) rn
      from need_metrics m join needs n on n.id = m.need_id
      where m.tier = 'main'
        and not exists (select 1 from feedback f where f.need_id = m.need_id and f.country = m.country and f.verdict = 'down') -- 你标了没价值的不再写卡片
        and m.country = any(${pgTextArray(ctx.countries)}::text[])
        ${ctx.genres ? sql`and n.genre_id = any(${`{${ctx.genres.join(",")}}`}::int[])` : sql``})
    select r.need_id::float8 need_id, r.country, r.genre_id, r.title, r.description, r.kind,
           to_jsonb(r) - 'host_apps' m, c.evidence_mentions card_mentions, c.prompt_version card_version
    from ranked r left join opportunity_cards c on c.need_id = r.need_id and c.country = r.country
    where r.rn <= ${p.cards_per_genre}
    order by r.score desc`);
  s.candidates = cands.length;

  // 卡片之间互不依赖，按 concurrency 并行
  const todo = cands.filter((c) => {
    const fresh = c.card_mentions !== null && c.card_version === CARD_VERSION && Number(c.m.mentions) < c.card_mentions * (1 + p.card_rewrite_growth);
    if (fresh) s.skipped_fresh++;
    return !fresh;
  });
  let next = 0;
  const worker = async () => {
    while (!ctx.stopped && next < todo.length) await writeCard(todo[next++]!);
  };
  const writeCard = async (c: (typeof cands)[number]) => {
    const mentions = Number(c.m.mentions);
    const [hostsRow] = await ctx.db.execute<{ host_apps: { appId: number; mentions: number; analyzed: number }[] }>(sql`
      select host_apps from need_metrics where need_id = ${c.need_id} and country = ${c.country}`);
    const hostIds = (hostsRow?.host_apps ?? []).slice(0, 8).map((h) => h.appId);
    const apps = await ctx.db.execute<Record<string, unknown>>(sql`
      select a.app_id::float8 app_id, a.name, a.developer, a.price::float8 price, a.currency, a.rating_avg::float8 rating, a.rating_count,
             s.best_rank, s.best_chart, s.days_since_update, s.review_avg_90d::float8 written_review_avg, s.dev_type, s.tags,
             left(regexp_replace(split_part(btrim(a.description), chr(10), 1), '[[:space:]]+', ' ', 'g'), 120) about
      from apps a
      left join lateral (select * from app_signals x where x.app_id = a.app_id and x.country = a.country order by snapshot_date desc limit 1) s on true
      where a.country = ${c.country} and a.app_id = any(${`{${hostIds.join(",")}}`}::bigint[])`);
    // 引用：优先表示流失或付费意愿的、低分的，每个 App 最多 4 条
    const quotes = await ctx.db.execute<{ id: string; app_id: number; stars: number; statement: string; text: string }>(sql`
      select id, app_id, stars, statement, text from (
        select r.review_id id, r.app_id::float8 app_id, r.rating::int stars, st.text statement,
               left(coalesce(r.title || '：', '') || r.content, 300) text,
               row_number() over (partition by r.app_id order by (st.churn or st.pay) desc, r.rating, r.reviewed_at desc) rn,
               (st.churn or st.pay) hot, r.rating
        from review_statements st join reviews r on r.review_id = st.review_id
        join needs n on n.id = st.need_id
        where coalesce(n.merged_into, n.id) = ${c.need_id} and st.country = ${c.country}) x
      where rn <= 4 order by hot desc, rating limit 14`);

    const metrics = { ...c.m };
    for (const k of ["need_id", "country", "computed_on", "rn", "genre_id", "title", "description", "kind"]) delete metrics[k];
    const input = {
      need: { title: c.title, description: c.description, kind: `${c.kind}（${KINDS[c.kind as keyof typeof KINDS] ?? ""}）`, category: GENRES[c.genre_id]?.zh, country: c.country },
      metrics,
      host_apps: apps,
      quotes,
    };
    const out = await ask(ctx, CardSchema, SYSTEM, JSON.stringify(input));
    if (!out) { if (!ctx.stopped) s.failed++; return; }
    const appIds = new Set(apps.map((a) => Number(a.app_id)));
    const quoteIds = new Set(quotes.map((q) => q.id));
    out.existing = out.existing.filter((e) => appIds.has(e.app_id));
    out.quote_ids = out.quote_ids.filter((id) => quoteIds.has(id)).slice(0, 4);
    await ctx.db.insert(opportunityCards)
      .values({ needId: c.need_id, country: c.country, card: out, evidenceMentions: mentions, promptVersion: CARD_VERSION, provider: ctx.provider, model: ctx.model ?? "(默认)", createdAt: new Date() })
      .onConflictDoUpdate({
        target: [opportunityCards.needId, opportunityCards.country],
        set: { card: out, evidenceMentions: mentions, promptVersion: CARD_VERSION, provider: ctx.provider, model: ctx.model ?? "(默认)", createdAt: new Date() },
      });
    s.written++;
    log("cards", `${c.country}/${GENRES[c.genre_id]?.zh}：${out.title}（${mentions} 条评论，调用 ${ctx.calls}）`);
  };
  await Promise.all(Array.from({ length: Math.min(ctx.concurrency, todo.length) }, worker));
  await recordStep(ctx, "cards", started, s, ctx.stopped ? "partial" : "ok");
  return s;
}

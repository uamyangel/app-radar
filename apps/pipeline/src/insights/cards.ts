/**
 * S5 机会卡片：每个国家 × 品类，给排序分最高、达到主列表门槛的需求写卡片。
 * 证据增长超过 card_rewrite_growth 或提示词版本变了才重写，否则跳过（多次运行不重复）。
 *
 * 卡片先下结论（v3）：可做（一个人或小团队能做）/ 趋势（真实但个人做不了或会被现有产品补上）/ 不成立。
 * 以前只要进了主列表就必须写出「谁、切入、收费」，站不住的需求也被写得像模像样；现在模型可以、也应该说不。
 */
import { GENRES, opportunityCards } from "@app-radar/shared";
import { sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { pgTextArray } from "../stages/scope.ts";
import { KINDS } from "./extract.ts";
import { ask, log, recordStep, type RunCtx } from "./runner.ts";

export const CARD_VERSION = "card-v3"; // v3：按场景、先下结论（可做 / 趋势 / 不成立）；v2：证据用自然语言写

const text = z.string().catch("").transform((t) => t.trim());
export const VERDICTS = ["build", "trend", "reject"] as const;
export const CardSchema = z.object({
  verdict: z.string().transform((v) => {
    const x = v.trim().toLowerCase();
    return (x.includes("build") || x.includes("可做") ? "build" : x.includes("trend") || x.includes("趋势") ? "trend" : "reject") as (typeof VERDICTS)[number];
  }),
  verdict_reason: z.string().min(4).transform((t) => t.trim()), // 为什么这么判
  title: z.string().min(4).transform((t) => t.trim().slice(0, 50)), // 一句话机会
  who: text, // 谁有这个需求
  problem: text, // 具体遇到什么问题
  current: text, // 他们现在用什么、为什么还不满意
  why_unfixed: text, // 现有产品为什么不会自己修好
  evidence: text, // 证据摘要（只用程序给的数字）
  existing: z.array(z.object({ app_id: z.coerce.number(), gap: z.string() })).catch([]), // 现有产品哪里没做好
  indie_fit: text, // 个人能不能做、为什么
  complexity: z.string().catch("中").transform((c) => (["小", "中", "大"].includes(c.trim()) ? c.trim() : c.includes("大") ? "大" : c.includes("小") ? "小" : "中")),
  risks: z.array(z.string()).catch([]),
  angle: text, // 切入角度
  monetization: text, // 可能的收费方式
  quote_ids: z.array(z.coerce.string()).catch([]), // 最能说明问题的评论 id
});

const SYSTEM = `你是帮独立开发者找产品机会的分析师，判断要严格：从评论里归纳出的需求，大多数都不是机会。
给你：一个细分场景（场景里的 App 互为替代品）、这个场景的用户反复提到的一个需求、程序算好的证据、这个场景里排名靠前的 App（scene_apps）、提到这个需求的 App（host_apps）和代表性评论（quotes）。

先下结论 verdict：
- build（可做）：一个人或小团队能做一个新产品，接住现有 App 里因为这件事不满的那部分用户。必须同时满足：
  1. 这是这个场景里的共性诉求，不是某一个 App 的个别问题
  2. 说得出现有产品为什么不会自己修好：商业模式就靠它赚钱（弹窗、订阅、广告）、和产品定位冲突、长期不更新、用户群太小大公司看不上
  3. 评论里有人在换 App、找替代、愿意付费，或者不满集中且持续好几周
  4. 一个人能做出可用版本：不依赖硬件、内容版权、医疗金融等资质、网络效应
- trend（趋势）：需求真实、有一定规模，值得关注，但个人做不了，或者现有产品很快会补上（需要硬件、资质、版权、平台能力，新设备新系统带来的变化）
- reject（不成立）：其实是个别 App 的问题（功能被删、某次改版、它自己的 bug 和设置）；描述泛泛，看不出具体要什么；不同评论说的其实不是一件事；只是少数人顺口一提；现有产品改个设置就能解决

verdict_reason：一两句说明为什么这么判，要具体到这个场景和评论内容，不要套话。

只输出 JSON（简体中文）：
{
  "verdict": "build / trend / reject",
  "verdict_reason": "…",
  "title": "一句话说清机会，25 字以内，带上场景，例如「没有弹窗和角色的极简经期记录」；reject 时写清这条需求实际是什么",
  "who": "谁有这个需求（具体人群和场景）",
  "problem": "他们遇到的具体问题",
  "current": "他们现在用什么（scene_apps 里的哪几个），为什么还不满意",
  "why_unfixed": "现有产品为什么不会自己修好；说不出来就写「说不出」",
  "evidence": "证据摘要：用自然语言引用输入里的数字，例如「14 条评论、来自 2 个 App，持续 10 周；在主要承载 App 的评论里至少约 3 成提到」。不要自己编数字，不要出现 pay_n、prevalence_lb、score 这类字段名或打分数值",
  "existing": [{"app_id": 0, "gap": "这个 App 在这件事上哪里没做好"}],
  "indie_fit": "一个人能不能做、为什么",
  "complexity": "小 / 中 / 大（一个人做出可用版本的工作量）",
  "risks": ["主要风险，2–4 条"],
  "angle": "最可行的切入角度（差异化在哪）",
  "monetization": "可能的收费方式",
  "quote_ids": ["2–4 个最能说明问题的评论 id"]
}

要求：只依据输入，不编造；existing 和 quote_ids 只能用输入里出现过的 id。verdict 为 reject 时，who、current、why_unfixed、indie_fit、angle、monetization 可以留空字符串，risks 可以为空数组。`;


export type CardCand = {
  need_id: number; country: string; genre_id: number; title: string; description: string | null; kind: string; m: Record<string, unknown>;
  scene_id: number | null; scene: string | null; scene_desc: string | null;
};
export const cardBench = { SYSTEM };

/** 写卡片的输入：需求、程序算好的指标、承载 App、代表性评论 */
export async function cardInput(db: RunCtx["db"], c: CardCand) {
  const [hostsRow] = await db.execute<{ host_apps: { appId: number; mentions: number; analyzed: number }[] }>(sql`
    select host_apps from need_metrics where need_id = ${c.need_id} and country = ${c.country}`);
  const hostIds = (hostsRow?.host_apps ?? []).slice(0, 8).map((h) => h.appId);
  const apps = await db.execute<Record<string, unknown>>(sql`
    select a.app_id::float8 app_id, a.name, a.developer, a.price::float8 price, a.currency, a.rating_avg::float8 rating, a.rating_count,
           s.best_rank, s.best_chart, s.days_since_update, s.review_avg_90d::float8 written_review_avg, s.dev_type, s.tags,
           left(regexp_replace(split_part(btrim(a.description), chr(10), 1), '[[:space:]]+', ' ', 'g'), 120) about
    from apps a
    left join lateral (select * from app_signals x where x.app_id = a.app_id and x.country = a.country order by snapshot_date desc limit 1) s on true
    where a.country = ${c.country} and a.app_id = any(${`{${hostIds.join(",")}}`}::bigint[])`);
  // 引用：优先表示流失或付费意愿的、低分的，每个 App 最多 4 条
  const quotes = await db.execute<{ id: string; app_id: number; stars: number; statement: string; text: string }>(sql`
    select id, app_id, stars, statement, text from (
      select r.review_id id, r.app_id::float8 app_id, r.rating::int stars, st.text statement,
             left(coalesce(r.title || '：', '') || r.content, 300) text,
             row_number() over (partition by r.app_id order by (st.churn or st.pay) desc, r.rating, r.reviewed_at desc) rn,
             (st.churn or st.pay) hot, r.rating
      from review_statements st join reviews r on r.review_id = st.review_id
      join needs n on n.id = st.need_id
      where coalesce(n.merged_into, n.id) = ${c.need_id} and st.country = ${c.country}) x
    where rn <= 4 order by hot desc, rating limit 14`);

  // 这个场景里排名靠前的 App：用户现在用什么（替代品）
  const sceneApps = c.scene_id === null ? [] : await db.execute<Record<string, unknown>>(sql`
    select a.app_id::float8 app_id, a.name, a.developer, a.price::float8 price, a.rating_avg::float8 rating, a.rating_count,
           s.best_rank, s.days_since_update, s.dev_type
    from app_scenes x join apps a on a.app_id = x.app_id and a.country = ${c.country}
    left join lateral (select * from app_signals y where y.app_id = a.app_id and y.country = a.country order by snapshot_date desc limit 1) s on true
    where x.scene_id = ${c.scene_id}
    order by s.best_rank nulls last, a.rating_count desc nulls last limit 8`);

  const metrics = { ...c.m };
  for (const k of ["need_id", "country", "computed_on", "rn", "genre_id", "title", "description", "kind", "scene_id", "scene", "scene_desc"]) delete metrics[k];
  const input = {
    scene: { name: c.scene, description: c.scene_desc, category: GENRES[c.genre_id]?.zh },
    need: { title: c.title, description: c.description, kind: `${c.kind}（${KINDS[c.kind as keyof typeof KINDS] ?? ""}）`, country: c.country },
    metrics,
    scene_apps: sceneApps,
    host_apps: apps,
    quotes,
  };
  return { input, apps, quotes };
}

export async function runCards(ctx: RunCtx) {
  const started = new Date();
  const p = ctx.cfg.insights.pipeline;
  const s = { candidates: 0, written: 0, skipped_fresh: 0, failed: 0, build: 0, trend: 0, reject: 0 };

  const cands = await ctx.db.execute<CardCand & { card_mentions: number | null; card_version: string | null }>(sql`
    with ranked as (
      select m.*, n.genre_id, n.title, n.description, n.kind, n.scene_id::float8 scene_id, sc.name scene, sc.description scene_desc,
             row_number() over (partition by m.country, n.genre_id order by m.score desc) rn
      from need_metrics m join needs n on n.id = m.need_id left join scenes sc on sc.id = n.scene_id
      where m.tier = 'main'
        and not exists (select 1 from feedback f where f.need_id = m.need_id and f.country = m.country and f.verdict = 'down') -- 你标了没价值的不再写卡片
        and m.country = any(${pgTextArray(ctx.countries)}::text[])
        ${ctx.genres ? sql`and n.genre_id = any(${`{${ctx.genres.join(",")}}`}::int[])` : sql``})
    select r.need_id::float8 need_id, r.country, r.genre_id, r.title, r.description, r.kind, r.scene_id, r.scene, r.scene_desc,
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
    const { input, apps, quotes } = await cardInput(ctx.db, c);
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
    s[out.verdict]++;
    log("cards", `${c.country}/${c.scene ?? GENRES[c.genre_id]?.zh}：[${out.verdict}] ${out.title}（${mentions} 条评论，调用 ${ctx.calls}）`);
  };
  await Promise.all(Array.from({ length: Math.min(ctx.concurrency, todo.length) }, worker));
  await recordStep(ctx, "cards", started, s, ctx.stopped ? "partial" : "ok");
  return s;
}

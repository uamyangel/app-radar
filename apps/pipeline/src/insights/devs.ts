/**
 * 开发者类型的 AI 补充判断（docs/insights-design.md 第 4.1 节）：
 * 前 300 名由 config/developers.yaml 手工定（source=manual，始终优先）；其余在 AI 分析范围内、还没分类的开发者，
 * 由 AI 批量判断（source=ai），只处理一次，之后只处理新出现的。
 */
import { developers } from "@app-radar/shared";
import { DEVELOPER_TYPES } from "@app-radar/shared/config";
import { sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { pgIntArray } from "../stages/scope.ts";
import { ask, log, recordStep, type RunCtx } from "./runner.ts";

const BATCH = 150;
const Out = z.object({
  devs: z.array(z.object({
    id: z.coerce.number(),
    type: z.string().transform((t) => ((DEVELOPER_TYPES as readonly string[]).includes(t) ? t : "normal")),
  })),
});

const SYSTEM = `你在给 App Store 的开发者分类，用来判断他们的 App 里有没有个人开发者能切入的机会。给你开发者名称和他们的代表 App，每个开发者选一类：
- platform：大型科技平台或其子公司（如 Google、腾讯、字节、阿里、微软、亚马逊、Meta、百度、LINE、乐天）
- brand：非软件公司的自家服务 App，用户用它是因为这家公司的业务（银行、保险、券商、支付、零售、餐饮、航空、酒店、出行、物流、运营商、政府机构、医院、学校、招聘平台、车企、家电设备配套）
- content：内容或网络效应平台（流媒体、新闻媒体、社交、交友、UGC 社区、出版社的内容 App、游戏公司）
- major：大公司的单个产品（有名的大型 App 公司，但产品本身是工具，如 Duolingo、Canva、MyFitnessPal）
- normal：个人开发者、小团队、工具类工作室、普通软件公司（拿不准时选这个）

判断依据是「用户的需求能不能被一个独立开发者的同类产品满足」：银行 App 的用户要的是这家银行的服务，所以是 brand；记账 App 不管谁做都行，所以是 normal。
每个开发者都要返回，id 原样返回。只输出 JSON：{"devs":[{"id":123,"type":"normal"}]}`;

export async function runDevs(ctx: RunCtx) {
  const started = new Date();
  const s = { classified: 0, batches: 0, by_type: {} as Record<string, number> };
  const include = pgIntArray(ctx.genres ?? ctx.cfg.insights.include_genres);
  for (;;) {
    if (ctx.stopped) break;
    // 有近期评论的、还没分类的开发者；评分多的先做（更可能是品牌）
    const rows = await ctx.db.execute<{ id: number; name: string; apps: string }>(sql`
      select a.developer_id::float8 id, max(a.developer) name,
             string_agg(distinct left(a.name, 40), ' / ') filter (where a.name is not null) apps
      from apps a
      left join developers d on d.developer_id = a.developer_id
      where d.developer_id is null and a.developer_id is not null
        and a.primary_genre_id = any(${include}::int[])
        and exists (select 1 from reviews r where r.app_id = a.app_id and r.country = a.country and r.reviewed_at > now() - interval '90 days')
      group by a.developer_id
      order by max(a.rating_count) desc nulls last
      limit ${BATCH}`);
    if (rows.length === 0) break;
    const out = await ask(ctx, Out, SYSTEM, rows.map((r) => `#${r.id} ${r.name}｜${(r.apps ?? "").split(" / ").slice(0, 3).join(" / ")}`).join("\n"));
    s.batches++;
    if (!out) break;
    const want = new Map(rows.map((r) => [r.id, r]));
    const got = out.devs.filter((d) => want.has(d.id));
    // 模型漏掉的按 normal 记，避免反复取到同一批；手工分类（manual）不覆盖
    const map = new Map(got.map((d) => [d.id, d.type]));
    const now = new Date();
    await ctx.db.insert(developers)
      .values(rows.map((r) => ({ developerId: r.id, name: r.name, type: map.get(r.id) ?? "normal", source: "ai", updatedAt: now })))
      .onConflictDoNothing();
    for (const r of rows) { const t = map.get(r.id) ?? "normal"; s.by_type[t] = (s.by_type[t] ?? 0) + 1; }
    s.classified += rows.length;
    log("devs", `已分类 ${s.classified} 个开发者：${Object.entries(s.by_type).map(([k, v]) => `${k} ${v}`).join("、")}（调用 ${ctx.calls}）`);
  }
  await recordStep(ctx, "devs", started, s, ctx.stopped ? "partial" : "ok");
  return s;
}

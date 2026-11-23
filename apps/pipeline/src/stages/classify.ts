import { TOPIC_CODES, TOPICS, type Country } from "@app-radar/shared";
import { sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { Job, log, type Ctx } from "../context.ts";
import { Llm, pool, requireApiKey } from "../llm.ts";

type Row = { review_id: string; rating: number; title: string | null; content: string; reviewed_at: string };

const Out = z.object({
  items: z.array(z.object({ id: z.string(), t: z.array(z.string()).min(1).max(3), g: z.string().nullish() })),
});

const SYSTEM = `你是 App Store 评论分析助手。给每条评论打标签，用来统计用户在说什么问题。

标签只能从下面选 1–2 个，最主要的放前面：
${TOPIC_CODES.map((c) => `- ${c}：${TOPICS[c].label}（${TOPICS[c].hint}）`).join("\n")}

规则：
1. 只有评论纯粹表达满意、没有提到具体问题时才用 praise；好评里提到了问题，用对应的问题标签。
2. 评分 1–3 星的评论，g 写一句简体中文要点（不超过 20 个字），说清楚具体是什么问题或需求，例如"导出 PDF 后排版错乱""免费版每天只能用 3 次"；不要写"用户不满意"这类空话。评分 4–5 星的 g 写空字符串。
3. 评论可能是任何语言，要点一律用简体中文。
4. 只输出 JSON：{"items":[{"id":"评论 id","t":["标签"],"g":"要点"}]}，每条输入都要有对应的输出。`;

/**
 * 评论归类（每天）：近 30 天内未归类的评论按时间从新到旧处理，预算用完就停，剩下的明天继续。
 * 只归类近 30 天：详情页、摘要、简报用到的归类统计都是近 30 天窗口。
 * dry-run：每个国家只跑一批并打印结果，不写库。
 */
export async function runClassify(ctx: Ctx) {
  const job = await new Job(ctx, "classify").start();
  const llm = new Llm(ctx, job, requireApiKey());
  const size = ctx.cfg.llm.classify_batch_size;
  const s = { batches: 0, classified: 0, missing_in_output: 0, stopped_by_budget: false, stopped_by_peak: false, stopped_by_deadline: false };
  job.stats = { ...s, llm: llm.stats };

  for (const cc of ctx.countries) {
    let cursor: { at: string; id: string } | null = null;
    for (;;) {
      if (Date.now() > ctx.deadline) { s.stopped_by_deadline = true; break; }
      if (llm.peakBlocked()) { s.stopped_by_peak = true; break; }
      if (!(await llm.budgetLeft())) { s.stopped_by_budget = true; break; }
      if (ctx.limit !== null && s.batches >= ctx.limit) break;
      const rows = await fetchChunk(ctx, cc, cursor, ctx.dryRun ? size : size * 50);
      if (rows.length === 0) break;
      const last = rows.at(-1)!;
      cursor = { at: last.reviewed_at, id: last.review_id };
      let batches: Row[][] = [];
      for (let i = 0; i < rows.length; i += size) batches.push(rows.slice(i, i + size));
      if (ctx.limit !== null) batches = batches.slice(0, Math.max(0, ctx.limit - s.batches));

      const r = await pool(batches, ctx.cfg.llm.concurrency, async (batch) => {
        const out = await llm.json(Out, [
          { role: "system", content: SYSTEM },
          { role: "user", content: JSON.stringify(batch.map((x) => ({ id: x.review_id, r: x.rating, t: x.title ?? "", c: x.content.slice(0, 800) }))) },
        ], 4000);
        s.batches++;
        if (!out) return;
        const want = new Set(batch.map((x) => x.review_id));
        const items = out.items
          .filter((x) => want.has(x.id))
          .map((x) => {
            const t = [...new Set(x.t.filter((c): c is (typeof TOPIC_CODES)[number] => (TOPIC_CODES as string[]).includes(c)))].slice(0, 2);
            return { id: x.id, t: t.length ? t : ["other"], g: (x.g ?? "").trim().slice(0, 40) };
          });
        s.missing_in_output += want.size - items.length; // 没返回的下次再归类
        s.classified += items.length;
        if (ctx.dryRun) {
          for (const x of items.slice(0, 8)) {
            const src = batch.find((b) => b.review_id === x.id)!;
            log("classify", `${src.rating}★ [${x.t.join(",")}] ${x.g || "-"} ← ${(src.title ?? "").slice(0, 30)} | ${src.content.slice(0, 60).replace(/\s+/g, " ")}`);
          }
          return;
        }
        await ctx.db!.execute(sql`
          update reviews r set
            topics = array(select jsonb_array_elements_text(x->'t')),
            gist = nullif(x->>'g', ''),
            classified_at = now()
          from jsonb_array_elements(${JSON.stringify(items)}::jsonb) x
          where r.review_id = x->>'id'`);
      });
      if (r.stoppedByBudget) { s.stopped_by_budget = true; break; }
      if (ctx.dryRun) break;
      log("classify", `${cc} 已归类 ${s.classified} 条，费用 $${llm.stats.cost_usd.toFixed(3)}`);
    }
    if (s.stopped_by_budget || s.stopped_by_deadline) break;
  }

  job.stats = { ...s, llm: llm.stats };
  if (s.stopped_by_peak) log("classify", "⚠️ 现在是 DeepSeek 高峰时段（价格翻倍），跳过，下次运行再处理");
  else if (s.stopped_by_budget) log("classify", "⚠️ 已达每日预算或余额不足，剩余评论下次继续");
  return job.finish();
}

/** 按 (reviewed_at desc, review_id) 翻页取未归类的评论；dry-run 没有库时返回空 */
async function fetchChunk(ctx: Ctx, cc: Country, cursor: { at: string; id: string } | null, limit: number): Promise<Row[]> {
  if (!ctx.db) return []; // dry-run 没有库：测试时请对本地副本库正式运行并加 --limit
  const rows = await ctx.db.execute<Row>(sql`
    select review_id, rating::int, title, content, to_json(reviewed_at)#>>'{}' reviewed_at
    from reviews
    where country = ${cc} and classified_at is null
      and reviewed_at > now() - interval '30 days' -- 归类结果只用在近 30 天的统计里，更早的不归类
      ${cursor ? sql`and (reviewed_at, review_id) < (${cursor.at}::timestamptz, ${cursor.id})` : sql``}
    order by reviewed_at desc, review_id desc
    limit ${limit}`);
  return [...rows];
}

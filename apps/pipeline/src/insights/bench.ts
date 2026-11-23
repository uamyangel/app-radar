/**
 * 模型基准：提取、归并、写卡片三步都用真实数据测（不写库），每个模型每项跑两遍看稳定性。
 *   pnpm insights:bench --provider cursor [--out 目录] composer-2.5-fast grok-4.7-low-fast ...
 *
 * 参照答案：
 *   提取 —— 健康健美（jp、us 各 30 条 1–3 星评论）当初由 Claude Sonnet 提取的结果
 *   归并 —— 同品类 130 条已归并的提法（应归回原需求、不新建）+ 20 条被判为太空泛的提法（应填 0）
 *   卡片 —— 没有标准答案，输出存下来人工读；程序只检查引用的 App 和评论 id 是否真实存在
 * 参照答案本身也是模型给的，所以「一致率」衡量的是和一个强模型的接近程度，分歧要人工看。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createDb } from "@app-radar/shared/db";
import { sql } from "@app-radar/shared/orm";
import type { z } from "zod";
import { assignBench, assignPrompt } from "./assign.ts";
import { cardBench, cardInput, CardSchema, type CardCand } from "./cards.ts";
import { benchExports } from "./extract.ts";
import { complete, extractJson, PROVIDERS, type Provider } from "./providers.ts";

const { values, positionals: models } = parseArgs({
  allowPositionals: true,
  options: { provider: { type: "string", default: "cursor" }, out: { type: "string", default: "bench-out" }, reps: { type: "string", default: "2" } },
});
const provider = values.provider as Provider;
if (!PROVIDERS.includes(provider)) throw new Error(`--provider 必须是 ${PROVIDERS.join(" / ")}`);
const REPS = Number(values.reps);
const GENRE = 6013;
const { db, client } = createDb(process.env.DATABASE_URL!, { max: 2 });

// ---------- 准备测试数据（固定抽样：按 md5 排序，每次相同） ----------
const reviews = await db.execute<{ id: string; app: string; stars: number; title: string; text: string; country: string }>(sql`
  (select r.review_id id, a.name app, r.rating::int stars, coalesce(r.title, '') title, left(r.content, 1000) text, r.country
   from review_extractions e join reviews r on r.review_id = e.review_id join apps a on a.app_id = r.app_id and a.country = r.country
   where e.model = 'sonnet' and e.country = 'jp' and e.genre_id = ${GENRE} and r.rating <= 3 order by md5(r.review_id) limit 30)
  union all
  (select r.review_id id, a.name app, r.rating::int stars, coalesce(r.title, '') title, left(r.content, 1000) text, r.country
   from review_extractions e join reviews r on r.review_id = e.review_id join apps a on a.app_id = r.app_id and a.country = r.country
   where e.model = 'sonnet' and e.country = 'us' and e.genre_id = ${GENRE} and r.rating <= 3 order by md5(r.review_id) limit 30)`);
const refStatements = await db.execute<{ review_id: string; text: string; kind: string }>(sql`
  select review_id, text, kind from review_statements where review_id = any(${`{${reviews.map((r) => `"${r.id}"`).join(",")}}`}::text[])`);
const refByReview = new Map<string, { text: string; kind: string }[]>();
for (const s of refStatements) refByReview.set(s.review_id, [...(refByReview.get(s.review_id) ?? []), s]);
const extractPayload = JSON.stringify(reviews.map(({ country: _c, ...r }) => ({ ...r, category: String(GENRE) })));

const catalog = await db.execute<{ id: number; title: string; description: string | null }>(sql`
  select id::float8 id, title, description from needs where genre_id = ${GENRE} and merged_into is null and not retired order by id`);
const assigned = await db.execute<{ id: number; text: string; kind: string; ref: number }>(sql`
  select st.id::float8 id, st.text, st.kind, coalesce(n.merged_into, n.id)::float8 ref
  from review_statements st join needs n on n.id = st.need_id
  where st.genre_id = ${GENRE} and st.country in ('jp', 'us') and not n.retired order by md5(st.id::text) limit 130`);
const vague = await db.execute<{ id: number; text: string; kind: string }>(sql`
  select id::float8 id, text, kind from review_statements where genre_id = ${GENRE} and need_id = 0 order by md5(id::text) limit 20`);
const assignBatch = [...assigned, ...vague.map((v) => ({ ...v, ref: 0 }))].sort((a, b) => a.id - b.id);
const assignUser = assignPrompt(GENRE, catalog, assignBatch);
const titleOf = new Map(catalog.map((c) => [c.id, c.title]));

const cardCands = await db.execute<CardCand>(sql`
  select distinct on (m.country) m.need_id::float8 need_id, m.country, n.genre_id, n.title, n.description, n.kind, to_jsonb(m) - 'host_apps' m
  from need_metrics m join needs n on n.id = m.need_id
  where m.tier = 'main' and n.genre_id in (6013, 6007, 6017) order by m.country, m.score desc`);
const cardInputs = await Promise.all(cardCands.map(async (c) => ({ c, ...(await cardInput(db, c)) })));
await client.end();

console.log(`测试数据：提取 ${reviews.length} 条评论（参照提法 ${refStatements.length} 条）；归并 ${assignBatch.length} 条提法、目录 ${catalog.length} 个需求；卡片 ${cardInputs.length} 张（${cardCands.map((c) => `${c.country}:${c.title}`).join("，")}）`);
console.log(`模型 ${models.join("、")}，每项 ${REPS} 遍，模型之间并行\n`);
mkdirSync(values.out!, { recursive: true });

// ---------- 调用 ----------
type Call<T> = { ok: true; data: T; secs: number; outTok: number | null } | { ok: false; err: string; secs: number };
async function call<S extends z.ZodTypeAny>(model: string, schema: S, system: string, user: string): Promise<Call<z.infer<S>>> {
  const t0 = Date.now();
  try {
    const r = await complete(provider, model, system, user);
    const parsed = schema.safeParse(extractJson(r.text));
    const secs = (Date.now() - t0) / 1000;
    if (!parsed.success) return { ok: false, err: `校验失败：${parsed.error.issues[0]?.message}`, secs };
    return { ok: true, data: parsed.data, secs, outTok: r.outputTokens };
  } catch (e) {
    return { ok: false, err: String(e).slice(0, 200), secs: (Date.now() - t0) / 1000 };
  }
}

const jaccard = (a: Set<string>, b: Set<string>) => (a.size + b.size === 0 ? 1 : [...a].filter((x) => b.has(x)).length / new Set([...a, ...b]).size);
const pct = (x: number) => `${Math.round(x * 100)}%`;
type ExtractOut = z.infer<typeof benchExports.Out>;
type AssignOut = z.infer<typeof assignBench.Out>;

function scoreExtract(out: ExtractOut) {
  const byId = new Map(out.items.map((i) => [i.id, i]));
  let tp = 0, fp = 0, fn = 0, kindJ = 0, kindN = 0, missing = 0, count = 0;
  for (const r of reviews) {
    const got = byId.get(r.id);
    if (!got) { missing++; continue; }
    const g = got.statements;
    const ref = refByReview.get(r.id) ?? [];
    count += g.length;
    if (g.length && ref.length) tp++; else if (g.length) fp++; else if (ref.length) fn++;
    if (g.length && ref.length) { kindJ += jaccard(new Set(g.map((s) => s.kind)), new Set(ref.map((s) => s.kind))); kindN++; }
  }
  const prec = tp / Math.max(1, tp + fp), rec = tp / Math.max(1, tp + fn);
  return { f1: (2 * prec * rec) / Math.max(1e-9, prec + rec), kind: kindJ / Math.max(1, kindN), missing, count };
}
function resolveAssign(out: AssignOut) {
  const m = new Map<number, string>(); // s → 目标（"#45" / "0" / "new:标题"）
  const newTitle = new Map(out.new_needs.map((n) => [n.key, n.title]));
  for (const a of out.assign) m.set(a.s, a.need === 0 ? "0" : a.need != null && titleOf.has(a.need) ? `#${a.need}` : a.new ? `new:${newTitle.get(a.new) ?? a.new}` : "?");
  return m;
}
function scoreAssign(out: AssignOut) {
  const m = resolveAssign(out);
  const known = assignBatch.filter((b) => b.ref > 0), vg = assignBatch.filter((b) => b.ref === 0);
  return {
    coverage: assignBatch.filter((b) => m.has(b.id)).length / assignBatch.length,
    same: known.filter((b) => m.get(b.id) === `#${b.ref}`).length / known.length,
    newRate: known.filter((b) => m.get(b.id)?.startsWith("new:")).length / known.length,
    zeroOnKnown: known.filter((b) => m.get(b.id) === "0").length / known.length,
    vagueCaught: vg.filter((b) => m.get(b.id) === "0").length / Math.max(1, vg.length),
    newNeeds: new Set([...m.values()].filter((v) => v.startsWith("new:"))).size,
  };
}

type Result = { model: string; extract: Call<ExtractOut>[]; assign: Call<AssignOut>[]; cards: Call<z.infer<typeof CardSchema>>[] };
const results: Result[] = await Promise.all(models.map(async (model) => {
  const r: Result = { model, extract: [], assign: [], cards: [] };
  const log = (step: string, c: Call<unknown>) => console.log(`${model.padEnd(24)} ${step.padEnd(8)} ${c.ok ? "通过" : `失败（${c.err}）`} ${c.secs.toFixed(0)}s`);
  for (let i = 0; i < REPS; i++) { const c = await call(model, benchExports.Out, benchExports.SYSTEM, extractPayload); r.extract.push(c); log(`提取${i + 1}`, c); }
  for (let i = 0; i < REPS; i++) { const c = await call(model, assignBench.Out, assignBench.SYSTEM, assignUser); r.assign.push(c); log(`归并${i + 1}`, c); }
  for (const ci of cardInputs) { const c = await call(model, CardSchema, cardBench.SYSTEM, JSON.stringify(ci.input)); r.cards.push(c); log(`卡片`, c); }
  writeFileSync(join(values.out!, `${model}.json`), JSON.stringify(r, null, 1));
  return r;
}));

// ---------- 汇总 ----------
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const lines: string[] = [];
lines.push("模型 | 提取：通过 秒 判断一致F1 类型一致 漏条 两遍一致 | 归并：通过 秒 覆盖 归回原需求 误新建 误判空泛 空泛识别 两遍一致 | 卡片：通过 秒 引用有效");
for (const r of results) {
  const ex = r.extract.filter((c) => c.ok).map((c) => (c as { data: ExtractOut }).data);
  const es = ex.map(scoreExtract);
  let exStable = NaN;
  if (ex.length === 2) {
    const [a, b] = ex.map((o) => new Map(o.items.map((i) => [i.id, i.statements.length > 0])));
    exStable = reviews.filter((rv) => a!.get(rv.id) === b!.get(rv.id)).length / reviews.length;
  }
  const as = r.assign.filter((c) => c.ok).map((c) => (c as { data: AssignOut }).data);
  const ss = as.map(scoreAssign);
  let asStable = NaN;
  if (as.length === 2) {
    const [a, b] = as.map(resolveAssign);
    // 两遍都新建的视为一致（新建的标题措辞会不同）
    asStable = assignBatch.filter((x) => { const p = a!.get(x.id), q = b!.get(x.id); return p === q || (p?.startsWith("new:") && q?.startsWith("new:")); }).length / assignBatch.length;
  }
  const cs = r.cards.filter((c) => c.ok) as { data: z.infer<typeof CardSchema>; secs: number }[];
  const refsOk = cs.map((c, i) => {
    const ci = cardInputs[i]!;
    const q = new Set(ci.quotes.map((x) => x.id)), ap = new Set(ci.apps.map((x) => Number(x.app_id)));
    const all = [...c.data.quote_ids.map((id) => q.has(id)), ...c.data.existing.map((e) => ap.has(e.app_id))];
    return all.filter(Boolean).length / Math.max(1, all.length);
  });
  const secs = (cs2: Call<unknown>[]) => avg(cs2.map((c) => c.secs)).toFixed(0);
  lines.push([
    r.model.padEnd(24),
    `${ex.length}/${r.extract.length} ${secs(r.extract)}s F1 ${pct(avg(es.map((s) => s.f1)))} 类型 ${pct(avg(es.map((s) => s.kind)))} 漏 ${avg(es.map((s) => s.missing))} 提法 ${avg(es.map((s) => s.count))} 稳 ${isNaN(exStable) ? "-" : pct(exStable)}`,
    `${as.length}/${r.assign.length} ${secs(r.assign)}s 覆盖 ${pct(avg(ss.map((s) => s.coverage)))} 归回 ${pct(avg(ss.map((s) => s.same)))} 新建 ${pct(avg(ss.map((s) => s.newRate)))}（${avg(ss.map((s) => s.newNeeds))} 个） 误0 ${pct(avg(ss.map((s) => s.zeroOnKnown)))} 空泛 ${pct(avg(ss.map((s) => s.vagueCaught)))} 稳 ${isNaN(asStable) ? "-" : pct(asStable)}`,
    `${cs.length}/${r.cards.length} ${secs(r.cards)}s 引用 ${pct(avg(refsOk))}`,
  ].join(" | "));
}
const summary = lines.join("\n");
console.log(`\n${summary}`);
writeFileSync(join(values.out!, "summary.txt"), summary);
// 供人工阅读：参照数据
writeFileSync(join(values.out!, "_ref.json"), JSON.stringify({ reviews, ref: Object.fromEntries(refByReview), assignBatch: assignBatch.map((b) => ({ ...b, refTitle: titleOf.get(b.ref) ?? (b.ref === 0 ? "（空泛）" : "?") })), cards: cardInputs.map((c) => c.input) }, null, 1));

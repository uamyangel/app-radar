/**
 * 模型基准：用同一批真实评论（不写库）比较多个模型的耗时、输出是否通过校验、提取出几条提法。
 *   pnpm insights:bench --provider cursor composer-2.5-fast grok-4.7-low-fast ...
 */
import { parseArgs } from "node:util";
import { createDb } from "@app-radar/shared/db";
import { sql } from "@app-radar/shared/orm";
import { benchExports } from "./extract.ts";
import { complete, extractJson, PROVIDERS, type Provider } from "./providers.ts";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { provider: { type: "string", default: "cursor" }, country: { type: "string", default: "jp" }, genre: { type: "string", default: "6002" } } });
const provider = values.provider as Provider;
if (!PROVIDERS.includes(provider)) throw new Error(`--provider 必须是 ${PROVIDERS.join(" / ")}`);
const { db, client } = createDb(process.env.DATABASE_URL!, { max: 1 });
const rows = await db.execute<{ id: string; app: string; stars: number; title: string; text: string }>(sql`
  select r.review_id id, a.name app, r.rating::int stars, coalesce(r.title, '') title, left(r.content, 1000) text
  from reviews r join apps a on a.app_id = r.app_id and a.country = r.country
  where r.country = ${values.country} and a.primary_genre_id = ${Number(values.genre)} and r.rating <= 3 and r.reviewed_at > now() - interval '60 days'
  order by r.review_id limit 60`);
await client.end();
const payload = JSON.stringify(rows.map((r) => ({ ...r, category: values.genre })));
console.log(`${rows.length} 条评论，${positionals.length} 个模型并行`);
await Promise.all(positionals.map(async (m) => {
  const t0 = Date.now();
  try {
    const r = await complete(provider, m, benchExports.SYSTEM, payload);
    const parsed = benchExports.Out.safeParse(extractJson(r.text));
    const n = parsed.success ? parsed.data.items.reduce((a, x) => a + x.statements.length, 0) : -1;
    const sample = parsed.success ? parsed.data.items.flatMap((x) => x.statements.map((s) => `${s.kind}:${s.text}`)).slice(0, 3).join(" ｜ ") : parsed.error.issues[0]?.message;
    console.log(`${m.padEnd(26)} ${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s  校验${parsed.success ? "通过" : "失败"}  条目 ${parsed.success ? parsed.data.items.length : "-"}  提法 ${n}  输入/输出 token ${r.inputTokens ?? "?"}/${r.outputTokens ?? "?"}\n    ${sample}`);
  } catch (e) {
    console.log(`${m.padEnd(26)} 失败：${String(e).slice(0, 160)}`);
  }
}));

/**
 * M0：实测 SPEC 第 3 节的所有 Apple 端点，输出原始结果到 scripts/m0-output/，
 * 汇总报告到 docs/m0-report.data.md（人工结论写在 docs/m0-report.md）。
 *
 * 用法：pnpm m0            （全量，约 4–5 分钟，按 1 req/s 限速）
 *       pnpm m0 --quick    （只测 genre=0 + 2 个品类）
 */
import { mkdir, writeFile } from "node:fs/promises";

const UA = "app-radar/0.1 (personal research; low frequency)";
const MIN_INTERVAL_MS = 1100;
const QUICK = process.argv.includes("--quick");

const COUNTRIES = ["us", "cn", "jp"] as const;
const GENRES: Record<number, string> = {
  0: "All",
  6007: "Productivity", 6000: "Business", 6017: "Education", 6013: "Health & Fitness",
  6020: "Medical", 6015: "Finance", 6002: "Utilities", 6027: "Graphics & Design",
  6008: "Photo & Video", 6012: "Lifestyle", 6026: "Developer Tools", 6006: "Reference",
  6023: "Food & Drink", 6003: "Travel", 6024: "Shopping", 6005: "Social Networking",
  6009: "News", 6018: "Books", 6011: "Music", 6016: "Entertainment",
};
const LEGACY_CHARTS = {
  free: "topfreeapplications",
  paid: "toppaidapplications",
  grossing: "topgrossingapplications",
} as const;

// ---------- HTTP：按主机限速 + 指数退避 ----------
const lastHit = new Map<string, number>();
let reqCount = 0;
const httpErrors: { url: string; status: number | string; attempt: number }[] = [];

async function get(url: string, maxRetries = 4): Promise<{ status: number; text: string; ms: number }> {
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt++) {
    const wait = (lastHit.get(host) ?? 0) + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());
    reqCount++;
    const t0 = Date.now();
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
      const text = await res.text();
      const ms = Date.now() - t0;
      if (res.ok) return { status: res.status, text, ms };
      httpErrors.push({ url, status: res.status, attempt });
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= maxRetries) return { status: res.status, text, ms };
    } catch (e) {
      httpErrors.push({ url, status: String(e), attempt });
      if (attempt >= maxRetries) return { status: 0, text: String(e), ms: Date.now() - t0 };
    }
    await sleep(1000 * 2 ** attempt + Math.random() * 500);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function parse(text: string): any {
  try { return JSON.parse(text); } catch { return undefined; }
}
const asArray = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

// ---------- A. 旧版 iTunes RSS 榜单 ----------
type ChartRow = {
  country: string; genre: number; chart: string; status: number; count: number;
  genreMatch: number; categories: Record<string, number>; dupIds: number; ms: number; ids: string[];
};

async function legacyCharts(): Promise<ChartRow[]> {
  const rows: ChartRow[] = [];
  const genres = QUICK ? [0, 6007, 6026] : Object.keys(GENRES).map(Number);
  for (const cc of COUNTRIES) for (const g of genres) for (const [chart, slug] of Object.entries(LEGACY_CHARTS)) {
    const url = `https://itunes.apple.com/${cc}/rss/${slug}/limit=100${g ? `/genre=${g}` : ""}/json`;
    const r = await get(url);
    const entries = asArray(parse(r.text)?.feed?.entry);
    const ids = entries.map((e: any) => e?.id?.attributes?.["im:id"] as string);
    const categories: Record<string, number> = {};
    let match = 0;
    for (const e of entries) {
      const cid = e?.category?.attributes?.["im:id"] as string;
      const term = e?.category?.attributes?.term as string;
      categories[`${cid}:${term}`] = (categories[`${cid}:${term}`] ?? 0) + 1;
      if (Number(cid) === g) match++;
    }
    rows.push({
      country: cc, genre: g, chart, status: r.status, count: entries.length,
      genreMatch: entries.length ? match / entries.length : 0, categories,
      dupIds: ids.length - new Set(ids).size, ms: r.ms, ids,
    });
    if (cc === "us" && g === 6007 && chart === "free") await save("legacy-chart-sample.json", r.text);
    process.stdout.write(`\rlegacy ${cc} ${g} ${chart} -> ${r.status} n=${entries.length}      `);
  }
  console.log();
  return rows;
}

// ---------- B. 新版 Marketing Tools RSS ----------
async function marketingCharts() {
  const out = [];
  for (const cc of COUNTRIES) for (const chart of ["top-free", "top-paid"]) {
    const url = `https://rss.marketingtools.apple.com/api/v2/${cc}/apps/${chart}/100/apps.json`;
    const r = await get(url, 5);
    const results = parse(r.text)?.feed?.results ?? [];
    out.push({ cc, chart, status: r.status, count: results.length, keys: Object.keys(results[0] ?? {}) });
    if (cc === "us" && chart === "top-free" && r.status === 200) await save("marketing-sample.json", r.text);
  }
  // 顺带试一下 grossing 和带 genre 的写法，确认文档说的"不支持"
  const probes = [
    "https://rss.marketingtools.apple.com/api/v2/us/apps/top-grossing/100/apps.json",
    "https://rss.marketingtools.apple.com/api/v2/us/apps/top-free/100/apps.json?genre=6007",
  ];
  const extra = [];
  for (const url of probes) {
    const r = await get(url, 2);
    const results = parse(r.text)?.feed?.results ?? [];
    extra.push({ url, status: r.status, count: results.length, genres: [...new Set(results.flatMap((x: any) => (x.genres ?? []).map((g: any) => g.name)))].slice(0, 8) });
  }
  return { out, extra };
}

// ---------- C. lookup 批量上限与字段 ----------
const LOOKUP_FIELDS = [
  "trackId", "trackName", "artistName", "artistId", "primaryGenreId", "genreIds", "price", "currency",
  "averageUserRating", "userRatingCount", "version", "releaseDate", "currentVersionReleaseDate",
  "releaseNotes", "description", "artworkUrl512", "artworkUrl100", "trackViewUrl", "formattedPrice",
];

async function lookup(idPool: Record<string, string[]>) {
  const batches = [];
  for (const size of [50, 100, 150, 200]) {
    const ids = (idPool.us ?? []).slice(0, size);
    if (ids.length < size) break;
    const url = `https://itunes.apple.com/lookup?id=${ids.join(",")}&country=us`;
    const r = await get(url);
    const j = parse(r.text);
    batches.push({ size, urlLen: url.length, status: r.status, resultCount: j?.resultCount ?? null, ms: r.ms });
  }
  // 各国字段完整度（每国 100 个）
  const fields: Record<string, { n: number; missing: Record<string, number>; iapHint: number; sample?: any }> = {};
  for (const cc of COUNTRIES) {
    const ids = (idPool[cc] ?? []).slice(0, 100);
    const r = await get(`https://itunes.apple.com/lookup?id=${ids.join(",")}&country=${cc}`);
    const results: any[] = parse(r.text)?.results ?? [];
    const missing: Record<string, number> = {};
    for (const f of LOOKUP_FIELDS) missing[f] = results.filter((x) => x[f] === undefined || x[f] === null).length;
    const allKeys = new Set(results.flatMap((x) => Object.keys(x)));
    const iapKeys = [...allKeys].filter((k) => /purchase|iap|offer/i.test(k));
    fields[cc] = { n: results.length, missing, iapHint: iapKeys.length, sample: { requested: ids.length, iapKeys, allKeys: [...allKeys].sort() } };
    if (cc === "us") await save("lookup-sample.json", JSON.stringify(results[0], null, 2));
  }
  return { batches, fields };
}

// ---------- D. 评论分页 ----------
async function reviews(targets: { cc: string; id: string; label: string }[]) {
  const out = [];
  for (const t of targets) {
    const pages = [];
    const seen = new Set<string>();
    let dup = 0;
    let orderViolations = 0;
    let prevTs = Infinity;
    for (let p = 1; p <= 11; p++) {
      const url = `https://itunes.apple.com/${t.cc}/rss/customerreviews/page=${p}/id=${t.id}/sortby=mostrecent/json`;
      const r = await get(url, 2);
      const feed = parse(r.text)?.feed;
      const entries = asArray<any>(feed?.entry);
      const reviewEntries = entries.filter((e) => e?.["im:rating"]);
      const appEntries = entries.length - reviewEntries.length;
      for (const e of reviewEntries) {
        const id = e.id?.label;
        if (seen.has(id)) dup++; else seen.add(id);
        const ts = Date.parse(e.updated?.label);
        if (ts > prevTs) orderViolations++;
        prevTs = ts;
      }
      const hasVote = reviewEntries.some((e) => e["im:voteSum"] !== undefined);
      pages.push({ p, status: r.status, reviews: reviewEntries.length, appEntries, hasVote });
      if (p === 1 && t.cc === "jp") await save("reviews-sample-jp.json", r.text);
      process.stdout.write(`\rreviews ${t.cc} ${t.id} p${p} -> ${r.status} n=${reviewEntries.length}     `);
    }
    // 第 1 页再重复请求 3 次，看空响应是否随机
    const repeats: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await get(`https://itunes.apple.com/${t.cc}/rss/customerreviews/page=1/id=${t.id}/sortby=mostrecent/json`, 0);
      repeats.push(asArray<any>(parse(r.text)?.feed?.entry).filter((e) => e?.["im:rating"]).length);
    }
    out.push({ ...t, pages, repeats, unique: seen.size, dup, orderViolations });
  }
  console.log();
  return out;
}

async function save(name: string, content: string) {
  await mkdir("scripts/m0-output", { recursive: true });
  await writeFile(`scripts/m0-output/${name}`, content);
}

// ---------- main ----------
async function main() {
  const t0 = Date.now();
  console.log("A. legacy charts…");
  const charts = await legacyCharts();

  console.log("B. marketing charts…");
  const marketing = await marketingCharts();

  const idPool: Record<string, string[]> = {};
  for (const cc of COUNTRIES) idPool[cc] = [...new Set(charts.filter((c) => c.country === cc).flatMap((c) => c.ids))];

  console.log("C. lookup…");
  const lk = await lookup(idPool);

  console.log("D. reviews…");
  // 用评论量巨大的知名 App 做对照：它们不可能真的没有评论，空响应只能是接口问题
  const targets = [
    { cc: "us", id: "284882215", label: "Facebook（对照）" },
    { cc: "cn", id: "414478124", label: "微信（对照）" },
    { cc: "jp", id: "443904275", label: "LINE（对照）" },
  ];
  const pick = (cc: string, g: number, chart: string, rank: number) =>
    charts.find((c) => c.country === cc && c.genre === g && c.chart === chart)?.ids[rank];
  const tail = pick("us", 6026, "paid", 60);
  if (tail) targets.push({ cc: "us", id: tail, label: "US 开发者工具付费 #61（长尾）" });
  const rv = await reviews(targets);

  // 全量去重 App 数和评论范围估算
  const uniqApps = Object.fromEntries(COUNTRIES.map((cc) => [cc, idPool[cc]!.length]));
  const top50 = Object.fromEntries(COUNTRIES.map((cc) => [cc, new Set(charts.filter((c) => c.country === cc).flatMap((c) => c.ids.slice(0, 50))).size]));

  const result = {
    at: new Date().toISOString(), quick: QUICK, totalRequests: reqCount, seconds: Math.round((Date.now() - t0) / 1000),
    httpErrors, charts: charts.map(({ ids, ...rest }) => rest), marketing, lookup: lk, reviews: rv, uniqApps, top50,
  };
  await save("results.json", JSON.stringify(result, null, 2));
  await mkdir("docs", { recursive: true });
  await writeFile("docs/m0-report.data.md", render(result));
  console.log(`done: ${reqCount} requests, ${result.seconds}s, ${httpErrors.length} http errors`);
}

function render(r: any): string {
  const L: string[] = [];
  L.push(`# M0 实测数据（自动生成）`, ``, `时间：${r.at}　请求数：${r.totalRequests}　耗时：${r.seconds}s　HTTP 错误（含重试）：${r.httpErrors.length}`, ``);
  L.push(`## A. 旧版 RSS 榜单`, ``, `| 国家 | genre | 榜单 | HTTP | 条数 | 品类匹配率 | 重复ID | 主要 category（前3） |`, `|---|---|---|---|---|---|---|---|`);
  for (const c of r.charts) {
    const top = Object.entries(c.categories as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}×${v}`).join(", ");
    L.push(`| ${c.country} | ${c.genre} ${GENRES[c.genre]} | ${c.chart} | ${c.status} | ${c.count} | ${c.genre ? (c.genreMatch * 100).toFixed(0) + "%" : "-"} | ${c.dupIds} | ${top} |`);
  }
  L.push(``, `## B. 新版 Marketing RSS`, ``, "```json", JSON.stringify(r.marketing, null, 1), "```");
  L.push(``, `## C. lookup`, ``, "```json", JSON.stringify(r.lookup.batches, null, 1), "```", ``);
  for (const [cc, f] of Object.entries<any>(r.lookup.fields)) {
    L.push(`- ${cc}: 请求 ${f.sample.requested}，返回 ${f.n}；缺失字段：${Object.entries(f.missing).filter(([, v]) => (v as number) > 0).map(([k, v]) => `${k}=${v}`).join(", ") || "无"}；疑似内购字段：${f.sample.iapKeys.join(",") || "无"}`);
  }
  L.push(``, `## D. 评论`, ``);
  for (const t of r.reviews) {
    L.push(`- ${t.cc} ${t.id}（${t.label}）：唯一评论 ${t.unique}，跨页重复 ${t.dup}，时间倒序违例 ${t.orderViolations}`);
    L.push(`  - 第 1 页重复 3 次：${t.repeats.join(" / ")}`);
    L.push(`  - 每页：${t.pages.map((p: any) => `p${p.p}:${p.status}/${p.reviews}${p.appEntries ? `(+${p.appEntries}app)` : ""}`).join(" ")}`);
  }
  L.push(``, `## 规模`, ``, `- 榜单去重 App 数：${JSON.stringify(r.uniqApps)}`, `- 各榜前 50 去重 App 数（评论采集范围）：${JSON.stringify(r.top50)}`);
  return L.join("\n") + "\n";
}

main().catch((e) => { console.error(e); process.exit(1); });

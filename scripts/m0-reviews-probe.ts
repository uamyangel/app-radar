/**
 * M0 补充：评论数据源的长期探测，比较两个来源：
 *   rss — itunes.apple.com/{cc}/rss/customerreviews（SPEC 3.3）
 *   web — apps.apple.com/api/apps/v1/catalog/{cc}/apps/{id}/reviews（网页版用的代理，无需 token）
 *
 * 固定 App 列表，GitHub Actions 每 4 小时跑一次，输出一行 JSON 到 probe-out/，
 * 用 scripts/m0-probe-analyze.ts 汇总多次运行的结果。
 */
import { mkdir, writeFile } from "node:fs/promises";

const UA = "app-radar/0.1 (personal research; low frequency)";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const RSS_GAP_MS = 1100;
const WEB_GAP_MS = Number(process.env.WEB_GAP_MS ?? 10_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const APPS: Record<string, string[]> = {
  us: ["284882215", "6448311069", "6473753684", "310633997", "389801252", "324684580", "422689480", "1232780281", "570060128", "632064380"],
  cn: ["414478124", "1485191072", "6459478672", "333206289", "387682726", "423084029", "741292507", "736536022", "461703208", "599852710"],
  jp: ["443904275", "6448311069", "6477489729", "1435783608", "667861049", "389801252", "333903271", "544007664", "297606951", "6760173601"],
};
const LANG: Record<string, string> = { us: "en-US", cn: "zh-Hans-CN", jp: "ja-JP" };

const lastHit = new Map<string, number>();
async function get(url: string, gap: number, ua: string) {
  const host = new URL(url).host;
  const wait = (lastHit.get(host) ?? 0) + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
  try {
    const res = await fetch(url, { headers: { "User-Agent": ua }, signal: AbortSignal.timeout(30_000) });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    return { status: 0, text: String(e) };
  }
}

function rssCount(text: string): { n: number; ids: string[] } {
  try {
    const e = JSON.parse(text)?.feed?.entry;
    const arr = (e === undefined ? [] : Array.isArray(e) ? e : [e]).filter((x: any) => x?.["im:rating"]);
    return { n: arr.length, ids: arr.map((x: any) => x.id.label) };
  } catch {
    return { n: -1, ids: [] };
  }
}
function webCount(text: string): { n: number; ids: string[]; newest?: string } {
  try {
    const d = JSON.parse(text)?.data ?? [];
    return { n: d.length, ids: d.map((x: any) => x.id), newest: d[0]?.attributes?.date };
  } catch {
    return { n: -1, ids: [] };
  }
}

async function main() {
  const at = new Date().toISOString();
  const rows: any[] = [];
  // 名称用于人工核对 ID 是否填对
  const names: Record<string, string> = {};
  for (const cc of Object.keys(APPS)) {
    const r = await get(`https://itunes.apple.com/lookup?id=${APPS[cc]!.join(",")}&country=${cc}`, RSS_GAP_MS, UA);
    for (const x of JSON.parse(r.text)?.results ?? []) names[`${cc}:${x.trackId}`] = x.trackName;
  }

  for (const cc of Object.keys(APPS)) {
    for (const id of APPS[cc]!) {
      const rss: number[] = [];
      const rssIds: string[] = [];
      for (const p of [1, 2, 3]) {
        const r = await get(`https://itunes.apple.com/${cc}/rss/customerreviews/page=${p}/id=${id}/sortby=mostrecent/json`, RSS_GAP_MS, UA);
        const c = r.status === 200 ? rssCount(r.text) : { n: -r.status, ids: [] };
        rss.push(c.n);
        rssIds.push(...c.ids);
      }
      const w = await get(
        `https://apps.apple.com/api/apps/v1/catalog/${cc}/apps/${id}/reviews?l=${LANG[cc]}&sort=recent&limit=20&platform=web&additionalPlatforms=appletv,ipad,iphone,mac`,
        WEB_GAP_MS,
        BROWSER_UA,
      );
      const wc = w.status === 200 ? webCount(w.text) : { n: -w.status, ids: [] as string[] };
      // 两个来源的评论 ID 是否同一套编号（决定能否混用去重）
      const overlap = wc.ids.filter((x) => rssIds.includes(x)).length;
      rows.push({ cc, id, name: names[`${cc}:${id}`] ?? "?", rss, web: wc.n, webNewest: wc.newest, overlap });
      console.log(`${cc} ${id.padEnd(11)} rss p1-3=${rss.join(",").padEnd(10)} web=${String(wc.n).padEnd(5)} overlap=${overlap}  ${names[`${cc}:${id}`] ?? "?"}`);
    }
  }
  const rssOk = rows.filter((r) => r.rss[0] > 0).length;
  const webOk = rows.filter((r) => r.web > 0).length;
  const web429 = rows.filter((r) => r.web === -429).length;
  console.log(`\nrss 第 1 页非空：${rssOk}/${rows.length}　web 非空：${webOk}/${rows.length}（429：${web429}）`);
  await mkdir("probe-out", { recursive: true });
  await writeFile(`probe-out/${at.replace(/[:.]/g, "-")}.json`, JSON.stringify({ at, webGapMs: WEB_GAP_MS, rows }));
}

main().catch((e) => { console.error(e); process.exit(1); });

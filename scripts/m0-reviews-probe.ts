/**
 * M0 补充：只测评论 RSS 接口是否稳定返回数据。
 * 设计成在 GitHub Actions（海外 IP）上跑，和本机（中国 IP）的结果对比。
 *
 * 对每个国家：1 个评论量巨大的对照 App + 免费总榜前 5 的 App；
 * 每个 App 请求第 1–3 页，再把第 1 页重复请求 3 次，统计非空比例。
 */
const UA = "app-radar/0.1 (personal research; low frequency)";
const INTERVAL_MS = 1100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let last = 0;
async function get(url: string) {
  const wait = last + INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
    return { status: res.status, text: await res.text(), cacheKey: res.headers.get("x-true-cache-key") ?? "" };
  } catch (e) {
    return { status: 0, text: String(e), cacheKey: "" };
  }
}
function countReviews(text: string): number {
  try {
    const e = JSON.parse(text)?.feed?.entry;
    const arr = e === undefined ? [] : Array.isArray(e) ? e : [e];
    return arr.filter((x: any) => x?.["im:rating"]).length;
  } catch {
    return -1;
  }
}

const CONTROL: Record<string, [string, string]> = {
  us: ["284882215", "Facebook"],
  cn: ["414478124", "微信"],
  jp: ["443904275", "LINE"],
};

async function main() {
  let total = 0;
  let nonEmpty = 0;
  let cacheKeySample = "";
  for (const cc of Object.keys(CONTROL)) {
    const chart = await get(`https://itunes.apple.com/${cc}/rss/topfreeapplications/limit=10/json`);
    const top: [string, string][] = (JSON.parse(chart.text)?.feed?.entry ?? [])
      .slice(0, 5)
      .map((e: any) => [e.id.attributes["im:id"], e["im:name"].label]);
    for (const [id, name] of [CONTROL[cc]!, ...top]) {
      const counts: number[] = [];
      for (const p of [1, 2, 3, 1, 1, 1]) {
        const r = await get(`https://itunes.apple.com/${cc}/rss/customerreviews/page=${p}/id=${id}/sortby=mostrecent/json`);
        const n = countReviews(r.text);
        counts.push(r.status === 200 ? n : -r.status);
        total++;
        if (n > 0) nonEmpty++;
        if (!cacheKeySample && r.cacheKey) cacheKeySample = r.cacheKey;
      }
      console.log(`${cc} ${id.padEnd(11)} p1,p2,p3,p1,p1,p1 = ${counts.join(",").padEnd(22)} ${name}`);
    }
  }
  console.log(`\n非空比例：${nonEmpty}/${total} = ${((nonEmpty / total) * 100).toFixed(0)}%`);
  console.log(`CDN 缓存键样例：${cacheKeySample || "(无)"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

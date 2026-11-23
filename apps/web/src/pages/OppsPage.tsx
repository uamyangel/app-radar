import { KIND_SHORT } from "@app-radar/shared/needs";
import { includeGenres } from "virtual:app-config";
import type { MetaResp, OppsResp } from "../../functions/_lib/types.ts";
import { AppIcon, Empty, ErrorBox } from "../components/bits.tsx";
import { KeyNumbers, Meters } from "../components/opp.tsx";
import { qs, useApi } from "../lib/api.ts";
import { navigate, onLinkClick, useScrollRestore } from "../lib/router.ts";

type Props = { meta: MetaResp; country: string; search: string };

/** 机会：本地 AI 从评论里归纳出的需求，按「证据 × 市场 × 缺口 × 可行」排序 */
export function OppsPage({ meta, country, search }: Props) {
  const p = new URLSearchParams(search);
  const tier = p.get("tier") === "watch" ? "watch" : "main";
  const genre = Number(p.get("ogenre") ?? 0) || null;
  const res = useApi<OppsResp>(`/api/opps?${qs({ country, tier, genre })}`);
  useScrollRestore(!!res.data && !res.loading);
  const genreName = (id: number) => meta.genres.find((g) => g.id === id)?.zh ?? String(id);
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(search);
    for (const [k, v] of Object.entries(patch)) v === null ? next.delete(k) : next.set(k, v);
    next.set("country", country);
    navigate(`/opps?${next}`, { replace: true });
  };
  const tab = (active: boolean) => `h-8 rounded-md px-3 text-sm ${active ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"}`;

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16">
      <div className="mt-4 flex flex-wrap items-center gap-1">
        <button className={tab(tier === "main")} onClick={() => go({ tier: null })}>主列表 <span className="tabular text-xs opacity-70">{res.data?.counts.main ?? ""}</span></button>
        <button className={tab(tier === "watch")} onClick={() => go({ tier: "watch" })} title="证据还不够：提到的人少或只出现在一个 App 里；以后更多人提到会自动升到主列表">
          待观察 <span className="tabular text-xs opacity-70">{res.data?.counts.watch ?? ""}</span>
        </button>
        <select aria-label="品类" className="ml-auto h-8 rounded-md border border-line bg-surface px-2 text-sm" value={genre ?? ""} onChange={(e) => go({ ogenre: e.target.value || null })}>
          <option value="">全部品类</option>
          {includeGenres.map((id) => <option key={id} value={id}>{genreName(id)}</option>)}
        </select>
      </div>
      <p className="mt-2 text-sm text-ink-2">
        从评论里归纳出的、没被满足的需求。排序分 = 证据 × 市场 × 缺口 × 可行，任何一项很弱都排不上来；数字由程序计算，卡片文字由 AI 撰写。
      </p>

      <div className="mt-4 space-y-3">
        {res.error && <ErrorBox msg={res.error} />}
        {res.loading && !res.data && <div className="h-64 animate-pulse rounded-lg bg-surface-2" />}
        {res.data && res.data.rows.length === 0 && (
          <Empty>还没有数据。在本机运行 <code className="rounded bg-surface-2 px-1">pnpm insights run --provider claude</code> 生成</Empty>
        )}
        {res.data?.rows.map((r) => (
          <a key={r.needId} href={`/need/${r.needId}?country=${country}`} onClick={onLinkClick} className="block rounded-lg border border-line p-4 hover:bg-surface-2">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h2 className="text-base font-semibold leading-snug">{r.card?.title ?? r.needTitle}</h2>
              <span className="text-xs text-ink-3">{genreName(r.genreId)} · {KIND_SHORT[r.kind] ?? r.kind}{r.card ? ` · 工作量${r.card.complexity}` : ""}</span>
            </div>
            {r.card && <div className="mt-0.5 text-sm text-ink-2">需求：{r.needTitle}</div>}
            <div className="mt-2"><Meters m={r.metrics} /></div>
            <div className="mt-2"><KeyNumbers m={r.metrics} /></div>
            {r.card && (
              <div className="mt-2 grid gap-1 text-sm text-ink-2 md:grid-cols-2">
                <div><span className="text-ink-3">谁：</span>{r.card.who}</div>
                <div><span className="text-ink-3">切入：</span>{r.card.angle}</div>
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {r.hostApps.map((h) => (
                <span key={h.appId} className="flex items-center gap-1 text-xs text-ink-3" title={`${h.name}：${h.mentions} 条提到（共分析 ${h.analyzed} 条）`}>
                  <AppIcon url={h.iconUrl} size={18} />
                  <span className="max-w-32 truncate">{h.name}</span>
                  <span className="tabular">{h.mentions}</span>
                </span>
              ))}
            </div>
          </a>
        ))}
      </div>
    </main>
  );
}

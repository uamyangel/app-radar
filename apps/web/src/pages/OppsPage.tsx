import { KIND_SHORT } from "@app-radar/shared/needs";
import { includeGenres } from "virtual:app-config";
import type { MetaResp, OppRow, OppsResp } from "../../functions/_lib/types.ts";
import { AppIcon, Empty, ErrorBox } from "../components/bits.tsx";
import { FeedbackButtons } from "../components/FeedbackButtons.tsx";
import { KeyNumbers, VERDICT_TEXT } from "../components/opp.tsx";
import { SeenMark, UnseenToggle } from "../components/SeenMark.tsx";
import { qs, useApi } from "../lib/api.ts";
import { navigate, onLinkClick, useScrollRestore } from "../lib/router.ts";
import { markSeen, type SeenState, useDwell, useSeen, useSeenItems, useUnseenSnapshot } from "../lib/seen.ts";

type Props = { meta: MetaResp; country: string; search: string };
type View = "build" | "trend" | "reject" | "pending" | "watch";
const VIEWS: View[] = ["build", "trend", "reject", "pending", "watch"];
const VIEW_TEXT: Record<View, string> = { build: "可做", trend: "趋势", reject: "不成立", pending: "待评估", watch: "待观察" };

/** 每一栏是什么 */
const VIEW_NOTE: Record<View, string> = {
  build: "一个人或小团队能做、能接住现有 App 不满用户的机会。每条都先由 AI 判断成不成立：说不出现有产品为什么不会自己修好的，不会出现在这里。",
  trend: "需求真实、有一定规模，但个人做不了（要硬件、资质、版权），或者现有产品很快会补上。值得留意方向。",
  reject: "AI 判为不成立的需求和理由，放在这里方便你核对。觉得判错了，标「有价值」。",
  pending: "达到主列表门槛、还没写卡片的需求，下次本地分析时会写。",
  watch: "证据还不够：提到的人少，或只出现在一个 App 里。以后更多人提到会自动升上来。",
};

/** 旧版机会（/opps/needs）：本地 AI 从评论里归纳出的需求，按场景归并，卡片先判断可做 / 趋势 / 不成立。新版见 EventsPage */
export function OppsPage({ meta, country, search }: Props) {
  const p = new URLSearchParams(search);
  const v = p.get("view") ?? (p.get("tier") === "watch" ? "watch" : "build"); // tier=watch 是旧链接
  const view: View = (VIEWS as string[]).includes(v) ? (v as View) : "build";
  const fb = p.get("fb") === "up" ? "up" : p.get("fb") === "down" ? "down" : "default";
  const genre = Number(p.get("ogenre") ?? 0) || null;
  const res = useApi<OppsResp>(`/api/opps?${qs({ country, view, genre, fb: fb === "default" ? null : fb })}`);
  useScrollRestore(!!res.data && !res.loading);
  // 看过的卡片：没看过的标蓝点；「只看没看过的」按进页面时的状态过滤
  const onlyUnseen = p.get("unseen") === "1";
  const key = (r: OppRow) => `${r.needId}:${country}`;
  const seenItems = useSeenItems(res.data?.rows, (r) => ({ key: key(r), ver: r.cardAt }));
  const seen = useSeen("need", seenItems);
  const snapshot = useUnseenSnapshot(seen.ready && !!res.data, seen.states, res.data);
  const unseenCount = seen.ready && res.data ? [...seen.states.values()].filter((x) => x !== "seen").length : null;
  const shown = onlyUnseen && snapshot ? res.data?.rows.filter((r) => snapshot.has(key(r))) : res.data?.rows;
  const genreName = (id: number) => meta.genres.find((g) => g.id === id)?.zh ?? String(id);
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(search);
    for (const [k, v] of Object.entries(patch)) v === null ? next.delete(k) : next.set(k, v);
    next.set("country", country);
    navigate(`/opps/needs?${next}`, { replace: true });
  };
  const tab = (active: boolean) => `h-8 rounded-md px-3 text-sm ${active ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"}`;

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16">
      <div className="mt-4 flex flex-wrap items-center gap-1">
        {VIEWS.map((x) => (x === "pending" && !res.data?.counts.pending ? null : (
          <button key={x} className={tab(fb === "default" && view === x)} onClick={() => go({ view: x === "build" ? null : x, tier: null, fb: null })}>
            {VIEW_TEXT[x]} <span className="tabular text-xs opacity-70">{res.data?.counts[x] ?? ""}</span>
          </button>
        )))}
        <span className="mx-1 h-5 w-px bg-line" />
        <button className={tab(fb === "up")} onClick={() => go({ fb: "up", view: null, tier: null })}>👍 有价值 <span className="tabular text-xs opacity-70">{res.data?.counts.up ?? ""}</span></button>
        <button className={tab(fb === "down")} onClick={() => go({ fb: "down", view: null, tier: null })} title="标了「没价值」的默认隐藏">👎 没价值 <span className="tabular text-xs opacity-70">{res.data?.counts.down ?? ""}</span></button>
        <span className="mx-1 h-5 w-px bg-line" />
        <UnseenToggle on={onlyUnseen} count={unseenCount} onChange={(on) => go({ unseen: on ? "1" : null })} />
        <select aria-label="品类" className="ml-auto h-8 rounded-md border border-line bg-surface px-2 text-sm" value={genre ?? ""} onChange={(e) => go({ ogenre: e.target.value || null })}>
          <option value="">全部品类</option>
          {includeGenres.map((id) => <option key={id} value={id}>{genreName(id)}</option>)}
        </select>
      </div>
      <p className="mt-2 text-sm text-ink-2">{fb === "default" ? VIEW_NOTE[view] : "你标过的需求。"}</p>

      {res.data && res.data.generic.length > 0 && fb === "default" && view === "build" && (
        <div className="mt-4 rounded-lg border border-line bg-surface-2/50 p-3">
          <div className="text-sm font-semibold text-ink-2">共性痛点 <span className="font-normal text-ink-3">（太贵、广告多这类抱怨，本身不是机会；在某个场景里提得多，说明在这个场景做对它是差异化角度）</span></div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {res.data.generic.map((x) => (
              <a key={x.needId} href={`/need/${x.needId}?country=${country}`} onClick={onLinkClick} className="text-ink-2 hover:text-ink hover:underline">
                {x.sceneName && <span className="text-ink-3">{x.sceneName} · </span>}{x.title} <span className="tabular text-xs text-ink-3">{x.mentions} 条 · {x.apps} 个 App</span>
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {res.error && <ErrorBox msg={res.error} />}
        {res.loading && !res.data && <div className="h-64 animate-pulse rounded-lg bg-surface-2" />}
        {onlyUnseen && shown && shown.length === 0 && res.data && res.data.rows.length > 0 && <Empty>这一页的卡片都看过了</Empty>}
        {res.data && res.data.rows.length === 0 && <Empty>这一栏现在是空的</Empty>}
        {shown?.map((r) => <OppItem key={r.needId} r={r} country={country} genreName={genreName} state={seen.states.get(key(r)) ?? null} />)}
      </div>
    </main>
  );
}

/** 一张机会卡片：在屏幕上停留 5 秒算看过（版本 = 卡片生成时间，卡片重写后显示「有更新」） */
function OppItem({ r, country, genreName, state }: { r: OppRow; country: string; genreName: (id: number) => string; state: SeenState | null }) {
  const ref = useDwell<HTMLAnchorElement>(() => markSeen("need", `${r.needId}:${country}`, r.cardAt), state === "unseen" || state === "updated");
  const c = r.card?.verdict ? r.card : null; // v3 以前的卡片没有结论，按没写卡片处理
  return (
    <a ref={ref} href={`/need/${r.needId}?country=${country}`} onClick={onLinkClick} className="block rounded-lg border border-line p-4 hover:bg-surface-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
        <SeenMark state={state} />
        <span className="rounded bg-surface-2 px-1.5 py-0.5 font-medium text-ink-2">{r.sceneName ?? genreName(r.genreId)}</span>
        <span>{KIND_SHORT[r.kind] ?? r.kind}</span>
        {c && <span className={c.verdict === "build" ? "text-up" : c.verdict === "reject" ? "text-down" : "text-ink-2"}>{VERDICT_TEXT[c.verdict!]}</span>}
        {c?.verdict === "build" && <span>工作量{c.complexity}</span>}
        {r.adaptation && <span title="现有 App 通常过一段时间会自己适配；排序分已降权，不进主列表">新设备适配 · 已降权</span>}
      </div>
      <h2 className="mt-1 text-base font-semibold leading-snug">{c?.title ?? r.needTitle}</h2>
      {c && <div className="mt-0.5 text-sm text-ink-3">用户说的：{r.needTitle}</div>}
      {c?.verdict_reason && <p className="mt-2 text-sm text-ink-2">{c.verdict_reason}</p>}
      {c?.verdict === "build" && c.angle && <p className="mt-1 text-sm text-ink-2"><span className="text-ink-3">切入：</span>{c.angle}</p>}
      <div className="mt-2"><KeyNumbers m={r.metrics} /></div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <FeedbackButtons key={`${r.needId}-${r.feedback?.verdict ?? ""}`} needId={r.needId} country={country} initial={r.feedback} />
        <span className="mx-1 h-4 w-px bg-line" />
        {r.hostApps.map((h) => (
          <span key={h.appId} className="flex items-center gap-1 text-xs text-ink-3" title={`${h.name}：${h.mentions} 条提到（共分析 ${h.analyzed} 条）`}>
            <AppIcon url={h.iconUrl} size={18} />
            <span className="max-w-32 truncate">{h.name}</span>
            <span className="tabular">{h.mentions}</span>
          </span>
        ))}
      </div>
    </a>
  );
}

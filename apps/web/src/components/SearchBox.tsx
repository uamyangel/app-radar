import { useEffect, useRef, useState } from "react";
import type { SearchResp } from "../../functions/_lib/types.ts";
import { getJson, qs } from "../lib/api.ts";
import { fmtCount } from "../lib/format.ts";
import { navigate } from "../lib/router.ts";
import { AppIcon } from "./bits.tsx";

/** 按名称或开发者搜索当前国家/地区采集过的 App */
export function SearchBox({ country }: { country: string }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResp["results"]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) { setRes([]); return; }
    let alive = true;
    const t = setTimeout(() => {
      getJson<SearchResp>(`/api/search?${qs({ country, q: term })}`).then(
        (r) => { if (alive) { setRes(r.results); setActive(0); setOpen(true); } },
        () => alive && setRes([]),
      );
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, country]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const go = (appId: number) => {
    setOpen(false);
    setQ("");
    navigate(`/app/${appId}?country=${country}`);
  };

  return (
    <div ref={box} className="relative w-full sm:w-56">
      <input
        type="search"
        value={q}
        placeholder="搜索 App 或开发者"
        aria-label="搜索 App 或开发者"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => res.length && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, res.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && res[active]) go(res[active].appId);
          else if (e.key === "Escape") setOpen(false);
        }}
        className="h-8 w-full rounded-md border border-line bg-surface px-2.5 text-sm placeholder:text-ink-3 focus:outline-2 focus:outline-accent"
      />
      {open && q.trim() && (
        <ul className="absolute right-0 z-30 mt-1 max-h-96 w-full min-w-72 overflow-auto rounded-md border border-line bg-surface py-1 shadow-lg" role="listbox">
          {res.length === 0 && <li className="px-3 py-2 text-sm text-ink-3">没有找到（只能搜到进过榜单的 App）</li>}
          {res.map((r, i) => (
            <li key={r.appId} role="option" aria-selected={i === active}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r.appId)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === active ? "bg-surface-2" : ""}`}
              >
                <AppIcon url={r.iconUrl} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink">{r.name}</span>
                  <span className="block truncate text-xs text-ink-3">{r.developer} · {fmtCount(r.ratingCount)} 评分</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

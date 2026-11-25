import { useMemo } from "react";
import { navigate, useLocation } from "./router.ts";

export type Filters = {
  country: string;
  genre: number;
  chart: "free" | "paid" | "grossing";
  date: string | null; // null = 最新
  quick: "" | "new" | "surge" | "lowhigh";
};

const KEY = "app-radar:filters";
const DEFAULTS: Filters = { country: "us", genre: 0, chart: "free", date: null, quick: "" };
const CHARTS = new Set(["free", "paid", "grossing"]);
const QUICK = new Set(["", "new", "surge", "lowhigh"]);

function stored(): Partial<Filters> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** URL 参数优先，其次是上次的选择（localStorage），最后是默认值。日期不记忆，默认总是最新 */
export function readFilters(search: string): Filters {
  const p = new URLSearchParams(search);
  const s = stored();
  const chart = p.get("chart") ?? s.chart ?? DEFAULTS.chart;
  const quick = p.get("quick") ?? "";
  const genre = Number(p.get("genre") ?? s.genre ?? DEFAULTS.genre);
  return {
    country: p.get("country") ?? s.country ?? DEFAULTS.country,
    genre: Number.isFinite(genre) ? genre : 0,
    chart: (CHARTS.has(chart) ? chart : "free") as Filters["chart"],
    date: p.get("date"),
    quick: (QUICK.has(quick) ? quick : "") as Filters["quick"],
  };
}

export function filtersToSearch(f: Partial<Filters>): string {
  const p = new URLSearchParams();
  if (f.country) p.set("country", f.country);
  if (f.genre !== undefined) p.set("genre", String(f.genre));
  if (f.chart) p.set("chart", f.chart);
  if (f.date) p.set("date", f.date);
  if (f.quick) p.set("quick", f.quick);
  return `?${p}`;
}

function remember(f: Filters) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ country: f.country, genre: f.genre, chart: f.chart }));
  } catch {
    /* 隐私模式等情况下不可用，忽略 */
  }
}

export function useFilters() {
  const loc = useLocation();
  const filters = useMemo(() => readFilters(loc.search), [loc.search]);
  /** 在品类页上改筛选；在详情页上改国家只刷新当前 App，改其他条件回到品类页 */
  const setFilters = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    remember(next);
    const onApp = loc.path.startsWith("/app/");
    const onLeads = ["/leads", "/opps", "/need/", "/favorites"].some((p) => loc.path.startsWith(p));
    const onlyCountry = Object.keys(patch).every((k) => k === "country");
    if (onLeads && onlyCountry) {
      const p = new URLSearchParams(loc.search);
      p.set("country", next.country);
      navigate(`${loc.path}?${p}`, { replace: true });
    } else if (onApp && onlyCountry) {
      navigate(`${loc.path}${filtersToSearch(next)}`, { replace: true });
    } else {
      navigate(`/${filtersToSearch(next)}`, { replace: !onApp });
    }
  };
  return { filters, setFilters, path: loc.path, search: loc.search };
}

import type { MetaResp } from "../functions/_lib/types.ts";
import { ErrorBox } from "./components/bits.tsx";
import { FilterBar } from "./components/FilterBar.tsx";
import { useApi } from "./lib/api.ts";
import { useFilters } from "./lib/filters.ts";
import { AppPage } from "./pages/AppPage.tsx";
import { CategoryPage } from "./pages/CategoryPage.tsx";

export function App() {
  const meta = useApi<MetaResp>("/api/meta");
  const { filters, setFilters, path } = useFilters();
  const appMatch = path.match(/^\/app\/(\d+)\/?$/);

  if (meta.error) return <div className="mx-auto max-w-xl p-6"><ErrorBox msg={`加载失败：${meta.error}`} /></div>;
  if (!meta.data) return <div className="p-6 text-sm text-ink-3">加载中…</div>;

  return (
    <>
      <FilterBar meta={meta.data} filters={filters} onChange={setFilters} onApp={!!appMatch} />
      {appMatch
        ? <AppPage meta={meta.data} appId={Number(appMatch[1])} country={filters.country} />
        : <CategoryPage meta={meta.data} filters={filters} setFilters={setFilters} />}
    </>
  );
}

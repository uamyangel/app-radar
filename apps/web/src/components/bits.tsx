/** 小组件：评分星、排名变化、App 图标、空状态 */

export function Stars({ value, size = "text-sm" }: { value: number | null; size?: string }) {
  if (value === null) return <span className="text-ink-3">–</span>;
  return (
    <span className={`tabular ${size}`} aria-label={`评分 ${value.toFixed(1)}`}>
      <span className={value < 4 ? "text-down" : "text-ink"}>★</span> {value.toFixed(1)}
    </span>
  );
}

/** 排名变化：正数 = 上升。prev 为空时：有历史数据就是新进榜，没有就不显示 */
export function Delta({ now, prev, hasHistory }: { now: number; prev: number | null; hasHistory: boolean }) {
  if (prev === null) return hasHistory ? <span className="text-xs text-accent">新</span> : <span className="text-ink-3">–</span>;
  const d = prev - now;
  if (d === 0) return <span className="text-ink-3">0</span>;
  return (
    <span className={`tabular ${d > 0 ? "text-up" : "text-down"}`} aria-label={d > 0 ? `上升 ${d}` : `下降 ${-d}`}>
      {d > 0 ? "▲" : "▼"}{Math.abs(d)}
    </span>
  );
}

export function AppIcon({ url, size = 36, alt = "" }: { url: string | null; size?: number; alt?: string }) {
  const style = { width: size, height: size, borderRadius: size * 0.225 };
  if (!url) return <div style={style} className="shrink-0 bg-surface-2" />;
  // Apple 图标 URL 末尾是尺寸，按 2 倍像素请求小图，省流量
  const px = Math.min(512, size * 2);
  const src = url.replace(/\/\d+x\d+bb\.(jpg|png)$/, `/${px}x${px}bb.$1`);
  return <img src={src} alt={alt} loading="lazy" style={style} className="shrink-0 border border-line object-cover" />;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-ink-3">{children}</div>;
}

export function ErrorBox({ msg }: { msg: string }) {
  return <div role="alert" className="rounded-lg border border-down/40 px-4 py-3 text-sm text-down">{msg}</div>;
}

export function Section({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

/**
 * 详情页顶部：只有一行——返回，加上当前看的是哪个国家/地区的数据。
 * 列表页那套筛选在详情页用不上，占掉手机上的大半屏。有别的国家的数据时可以直接切换。
 */
export function DetailTop({ onBack, country, countries, onCountry }: {
  onBack: () => void; country: string; countries: { code: string; name: string }[]; onCountry?: (cc: string) => void;
}) {
  const name = (cc: string) => countries.find((c) => c.code === cc)?.name ?? cc;
  const switchable = onCountry && countries.length > 1;
  return (
    <div className="mt-3 flex items-center justify-between gap-2">
      <button onClick={onBack} className="-ml-1 h-8 rounded-md px-1 text-sm text-ink-2 hover:text-ink">← 返回</button>
      {switchable ? (
        <div className="flex overflow-hidden rounded-md border border-line text-xs" role="radiogroup" aria-label="国家/地区">
          {countries.map((c) => (
            <button key={c.code} role="radio" aria-checked={c.code === country} onClick={() => onCountry(c.code)}
              className={`h-7 px-2.5 ${c.code === country ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"}`}>
              {c.name}
            </button>
          ))}
        </div>
      ) : (
        <span className="text-xs text-ink-3">{name(country)}的数据</span>
      )}
    </div>
  );
}

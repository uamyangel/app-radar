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

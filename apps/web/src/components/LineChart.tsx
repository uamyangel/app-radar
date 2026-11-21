import { useEffect, useMemo, useRef, useState } from "react";

export type Series = { key: string; label: string; color: string; points: { date: string; value: number }[] };

type Props = {
  series: Series[];
  invert?: boolean; // 排名：数值越小越靠上
  yDomain?: [number, number];
  format?: (v: number) => string;
  height?: number;
  emptyText?: string;
};

const M = { top: 10, right: 14, bottom: 24, left: 40 };
const DAY = 86_400_000;

/** 从最早到最晚，按天补齐的日期轴（缺的日期 = 当天不在榜，线在这里断开） */
function dayRange(series: Series[]): string[] {
  const all = series.flatMap((s) => s.points.map((p) => p.date)).sort();
  if (all.length === 0) return [];
  const out: string[] = [];
  for (let t = Date.parse(all[0]!); t <= Date.parse(all.at(-1)!); t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

function niceTicks(lo: number, hi: number, n = 4): number[] {
  const span = hi - lo || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

export function LineChart({ series, invert = false, yDomain, format = String, height = 220, emptyText = "暂无数据" }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dates = useMemo(() => dayRange(series), [series]);
  const lookup = useMemo(() => series.map((s) => new Map(s.points.map((p) => [p.date, p.value]))), [series]);
  const values = series.flatMap((s) => s.points.map((p) => p.value));

  if (dates.length === 0) {
    return <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-line text-sm text-ink-3">{emptyText}</div>;
  }

  let [lo, hi] = yDomain ?? [Math.min(...values), Math.max(...values)];
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  if (!yDomain) { lo -= pad; hi += pad; }
  if (invert) lo = Math.max(lo, 0.5);

  const iw = width - M.left - M.right;
  const ih = height - M.top - M.bottom;
  const x = (i: number) => M.left + (dates.length === 1 ? iw / 2 : (i / (dates.length - 1)) * iw);
  const y = (v: number) => M.top + (invert ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo)) * ih;
  const ticks = niceTicks(lo, hi).filter((t) => t >= lo && t <= hi && (!invert || t >= 1));
  const xTickEvery = Math.max(1, Math.ceil(dates.length / Math.max(2, Math.floor(iw / 70))));
  const showAllDots = dates.length <= 14;

  // 把每条线按连续的日期切成段
  const segments = series.map((_, si) =>
    dates.reduce<number[][]>((acc, d, i) => {
      if (lookup[si]!.has(d)) {
        const last = acc.at(-1);
        if (last && last.at(-1) === i - 1) last.push(i);
        else acc.push([i]);
      }
      return acc;
    }, []),
  );

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = dates.length === 1 ? 0 : Math.round((px / rect.width) * (dates.length - 1));
    setHover(Math.max(0, Math.min(dates.length - 1, i)));
  };

  return (
    <div>
      {series.length >= 2 && (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="图例">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div ref={wrap} className="relative">
        <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join("、")} className="block">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
              <text x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--ink-3)" className="tabular">
                {format(t)}
              </text>
            </g>
          ))}
          {dates.map((d, i) =>
            i % xTickEvery === 0 || i === dates.length - 1 ? (
              <text key={d} x={x(i)} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--ink-3)" className="tabular">
                {d.slice(5)}
              </text>
            ) : null,
          )}
          {series.map((s, si) => (
            <g key={s.key}>
              {segments[si]!.filter((seg) => seg.length > 1).map((seg, k) => (
                <polyline
                  key={k}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={seg.map((i) => `${x(i)},${y(lookup[si]!.get(dates[i]!)!)}`).join(" ")}
                />
              ))}
              {/* 孤立的点（前后都不在榜）或数据很少时画点，否则看不见 */}
              {segments[si]!.flatMap((seg) => (showAllDots || seg.length === 1 ? seg : [])).map((i) => (
                <circle key={i} cx={x(i)} cy={y(lookup[si]!.get(dates[i]!)!)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
            </g>
          ))}
          {hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + ih} stroke="var(--ink-3)" strokeWidth={1} strokeDasharray="3 3" />
              {series.map((s, si) => {
                const v = lookup[si]!.get(dates[hover]!);
                return v === undefined ? null : <circle key={s.key} cx={x(hover)} cy={y(v)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />;
              })}
            </g>
          )}
          <rect
            x={M.left}
            y={M.top}
            width={iw}
            height={ih}
            fill="transparent"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            onTouchStart={(e) => onMove(e.touches[0] as unknown as React.MouseEvent<SVGRectElement>)}
          />
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-sm"
            style={x(hover) > width / 2 ? { right: width - x(hover) + 10 } : { left: x(hover) + 10 }}
          >
            <div className="tabular mb-1 text-ink-3">{dates[hover]}</div>
            {series.map((s, si) => {
              const v = lookup[si]!.get(dates[hover]!);
              return (
                <div key={s.key} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-ink-2">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="tabular text-ink">{v === undefined ? "未上榜" : format(v)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <details className="mt-1 text-xs text-ink-3">
        <summary className="cursor-pointer select-none">数据表</summary>
        <div className="mt-1 max-h-56 overflow-auto">
          <table className="tabular w-full text-left">
            <thead><tr><th className="py-0.5 pr-3 font-medium">日期</th>{series.map((s) => <th key={s.key} className="py-0.5 pr-3 font-medium">{s.label}</th>)}</tr></thead>
            <tbody>
              {[...dates].reverse().map((d) => (
                <tr key={d}>
                  <td className="py-0.5 pr-3">{d}</td>
                  {series.map((s, si) => { const v = lookup[si]!.get(d); return <td key={s.key} className="py-0.5 pr-3 text-ink-2">{v === undefined ? "–" : format(v)}</td>; })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

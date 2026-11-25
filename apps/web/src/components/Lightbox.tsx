import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * 图片预览弹窗：左右滑动（原生横向滚动 + 吸附，手机上跟手）、电脑上用箭头按钮或 ← → 键切换。
 * 打开时往历史里压一条记录，手机的返回手势只关掉预览，不会离开页面。
 * 只加载当前和相邻两张大图，其余先用缩略图占位。
 */
export function Lightbox({ images, start, onClose }: { images: { thumb: string; full: string }[]; start: number; onClose: () => void }) {
  const [cur, setCur] = useState(start);
  const [loaded, setLoaded] = useState(() => new Set([start - 1, start, start + 1]));
  const scroller = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // 返回键 / 手势关闭；用按钮关闭时也走 history.back()，把压进去的那条记录退掉
  useEffect(() => {
    const st = history.state as { lightbox?: boolean } | null;
    if (!st?.lightbox) history.pushState({ ...st, lightbox: true }, ""); // 开发模式下 effect 会跑两次，别压两条
    const onPop = () => closeRef.current();
    window.addEventListener("popstate", onPop);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = overflow;
    };
  }, []);
  const close = () => history.back();

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = start * el.clientWidth;
  }, [start]);

  const go = (i: number) => {
    const el = scroller.current;
    if (!el || i < 0 || i >= images.length) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i === cur) return;
    setCur(i);
    setLoaded((s) => (s.has(i - 1) && s.has(i + 1) ? s : new Set([...s, i - 1, i, i + 1])));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") go(cur - 1);
    else if (e.key === "ArrowRight") go(cur + 1);
  };

  const btn = "absolute top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-2xl text-white hover:bg-white/25 disabled:opacity-0 sm:flex";
  return (
    <div ref={dialog} role="dialog" aria-modal="true" aria-label="截图预览" tabIndex={-1} onKeyDown={onKey} className="fixed inset-0 z-50 bg-black/95 outline-none">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((im, i) => (
          <div
            key={im.full}
            onClick={(e) => { if (e.target === e.currentTarget) close(); }}
            className="flex h-full w-full shrink-0 snap-center items-center justify-center px-2 pt-14 pb-12 sm:px-16"
          >
            <img src={loaded.has(i) ? im.full : im.thumb} alt={`截图 ${i + 1}`} draggable={false} className="max-h-full max-w-full rounded-lg object-contain select-none" />
          </div>
        ))}
      </div>

      <div style={{ top: "env(safe-area-inset-top)" }} className="absolute inset-x-0 flex items-center justify-between px-4 py-3 text-sm text-white/80">
        <span className="tabular">{cur + 1} / {images.length}</span>
        <button onClick={close} aria-label="关闭" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-xl text-white hover:bg-white/25">×</button>
      </div>
      <button onClick={() => go(cur - 1)} disabled={cur === 0} aria-label="上一张" className={`${btn} left-3`}>‹</button>
      <button onClick={() => go(cur + 1)} disabled={cur === images.length - 1} aria-label="下一张" className={`${btn} right-3`}>›</button>
    </div>
  );
}

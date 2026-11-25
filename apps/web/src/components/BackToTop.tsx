import { useEffect, useState } from "react";

/** 回到顶部：滚过一屏半才出现，固定在右下角（避开 iPhone 底部的手势条） */
export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > window.innerHeight * 1.5);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  if (!show) return null;
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="回到顶部"
      style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      className="fixed right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface/95 text-lg text-ink-2 shadow-md backdrop-blur hover:text-ink"
    >
      ↑
    </button>
  );
}

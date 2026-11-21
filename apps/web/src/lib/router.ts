import { useEffect, useState } from "react";

/**
 * 两个页面用不着路由库：history API + 自定义事件。
 * 滚动位置自己管：浏览器自带的恢复在数据异步渲染出来之前就执行了，会滚到错误位置。
 */
const EVT = "app:navigate";
const positions = new Map<string, number>();
let pendingScroll: number | null = null;
const keyOf = () => location.pathname + location.search;

if (typeof history !== "undefined") history.scrollRestoration = "manual";

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === keyOf()) return;
  if (opts.replace) {
    history.replaceState(history.state, "", to);
  } else {
    positions.set(keyOf(), window.scrollY);
    history.pushState({ inApp: true }, "", to);
    pendingScroll = 0;
  }
  window.dispatchEvent(new Event(EVT));
}

/** 「返回」：从站内进来的就后退（回到原来的列表和位置），直接打开的就去品类页 */
export function goBack(fallback: string) {
  if ((history.state as { inApp?: boolean } | null)?.inApp) history.back();
  else navigate(fallback);
}

export function useLocation() {
  const [loc, setLoc] = useState(() => ({ path: location.pathname, search: location.search }));
  useEffect(() => {
    const on = () => setLoc({ path: location.pathname, search: location.search });
    const onPop = () => {
      pendingScroll = positions.get(keyOf()) ?? 0;
      on();
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener(EVT, on);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener(EVT, on);
    };
  }, []);
  return loc;
}

/** 页面内容渲染好（ready）之后再恢复滚动位置 */
export function useScrollRestore(ready: boolean) {
  useEffect(() => {
    if (!ready || pendingScroll === null) return;
    const y = pendingScroll;
    pendingScroll = null;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }, [ready]);
}

/** 站内链接：左键在当前页切换，保留新标签页打开等浏览器默认行为 */
export function onLinkClick(e: React.MouseEvent<HTMLAnchorElement>) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(e.currentTarget.getAttribute("href")!);
}

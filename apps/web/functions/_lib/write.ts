/** 写接口共用：只接受同源请求（防跨站伪造），取 Access 登录邮箱 */

export function crossOrigin(req: Request): Response | null {
  const origin = req.headers.get("Origin");
  if (origin && new URL(origin).host !== new URL(req.url).host) return Response.json({ error: "来源不对" }, { status: 403 });
  return null;
}

/** 从 Access 令牌里取登录邮箱（令牌已由 /api 中间件校验过签名） */
export function accessEmail(req: Request): string | null {
  const direct = req.headers.get("Cf-Access-Authenticated-User-Email");
  if (direct) return direct;
  try {
    const p = req.headers.get("Cf-Access-Jwt-Assertion")?.split(".")[1];
    if (!p) return null;
    return (JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))) as { email?: string }).email ?? null;
  } catch {
    return null;
  }
}

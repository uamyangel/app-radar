import { verifyAccessJwt } from "../_lib/access.ts";
import type { Env } from "../_lib/db.ts";

/** 所有 /api 请求都要通过 Cloudflare Access 校验；本地开发（localhost）跳过；线上缺配置时拒绝（默认关闭） */
export const onRequest: PagesFunction<Env> = async (c) => {
  const host = new URL(c.request.url).hostname;
  if (host === "localhost" || host === "127.0.0.1") return c.next();
  const { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud } = c.env;
  if (!team || !aud) return Response.json({ error: "服务未配置访问控制" }, { status: 503 });
  const ok = await verifyAccessJwt(c.request.headers.get("Cf-Access-Jwt-Assertion"), team, aud);
  if (!ok) return Response.json({ error: "未登录" }, { status: 401 });
  return c.next();
};

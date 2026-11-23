import { feedback } from "@app-radar/shared";
import { and, eq, sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { Country } from "../_lib/api.ts";
import { dbFor, feedbackDbFor, type Env } from "../_lib/db.ts";

const Body = z.object({
  needId: z.number().int().positive(),
  country: Country,
  verdict: z.enum(["up", "down"]).nullable(), // null = 撤销标注
  note: z.string().trim().max(500).nullish(),
});

/** 从 Access 令牌里取登录邮箱（令牌已由 /api 中间件校验过签名） */
function emailFromJwt(token: string | null): string | null {
  try {
    const p = token?.split(".")[1];
    if (!p) return null;
    return (JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))) as { email?: string }).email ?? null;
  } catch {
    return null;
  }
}

/** 写反馈：只接受同源请求（防跨站伪造）；不缓存 */
export const onRequestPost: PagesFunction<Env> = async (c) => {
  const url = new URL(c.request.url);
  const origin = c.request.headers.get("Origin");
  if (origin && new URL(origin).host !== url.host) return Response.json({ error: "来源不对" }, { status: 403 });
  const parsed = Body.safeParse(await c.request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const { needId, country, verdict, note } = parsed.data;

  const ro = dbFor(c.env);
  const fb = feedbackDbFor(c.env);
  try {
    const where = and(eq(feedback.needId, needId), eq(feedback.country, country));
    if (verdict === null) {
      await fb.db.delete(feedback).where(where);
      return Response.json({ ok: true, feedback: null });
    }
    // 记下标注时的分项分数，用来分析哪个分项和你的判断最相关
    const [m] = await ro.db.execute<Record<string, unknown>>(sql`
      select mentions, apps, weeks_active, evidence::float8 evidence, market::float8 market, gap::float8 gap,
             feasibility::float8 feasibility, score::float8 score, tier
      from need_metrics where need_id = ${needId} and country = ${country}`);
    const now = new Date();
    const email = c.request.headers.get("Cf-Access-Authenticated-User-Email") ?? emailFromJwt(c.request.headers.get("Cf-Access-Jwt-Assertion"));
    await fb.db.insert(feedback)
      .values({ needId, country, verdict, note: note ?? null, metricsSnapshot: m ?? null, email, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [feedback.needId, feedback.country],
        set: { verdict, note: note ?? null, metricsSnapshot: m ?? null, email, updatedAt: now },
      });
    return Response.json({ ok: true, feedback: { verdict, note: note ?? null, updatedAt: now.toISOString() } });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "保存失败" }, { status: 500 });
  } finally {
    c.waitUntil(ro.close());
    c.waitUntil(fb.close());
  }
};

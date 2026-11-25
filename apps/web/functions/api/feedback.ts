import { feedback } from "@app-radar/shared";
import { and, eq, sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { Country } from "../_lib/api.ts";
import { dbFor, feedbackDbFor, type Env } from "../_lib/db.ts";
import { accessEmail, crossOrigin } from "../_lib/write.ts";

const Body = z.object({
  needId: z.number().int().positive(),
  country: Country,
  verdict: z.enum(["up", "down"]).nullable(), // null = 撤销标注
  note: z.string().trim().max(500).nullish(),
});

/** 写反馈：只接受同源请求（防跨站伪造）；不缓存 */
export const onRequestPost: PagesFunction<Env> = async (c) => {
  const denied = crossOrigin(c.request);
  if (denied) return denied;
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
    const email = accessEmail(c.request);
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

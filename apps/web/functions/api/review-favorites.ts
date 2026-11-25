import { favoriteReviews } from "@app-radar/shared";
import { eq } from "@app-radar/shared/orm";
import { z } from "zod";
import { api } from "../_lib/api.ts";
import { feedbackDbFor, type Env } from "../_lib/db.ts";
import type { ReviewFavoritesResp } from "../_lib/types.ts";
import { accessEmail, crossOrigin } from "../_lib/write.ts";

/** 收藏了哪些评论（评论列表上的按钮用）；数量不多，一次全取。不缓存 */
export const onRequestGet = api(z.object({}), async (_q, db): Promise<ReviewFavoritesResp> => {
  const rows = await db.select({ reviewId: favoriteReviews.reviewId, note: favoriteReviews.note }).from(favoriteReviews);
  return { items: Object.fromEntries(rows.map((r) => [r.reviewId, { note: r.note }])) };
}, { cache: false });

const Body = z.object({
  reviewId: z.string().min(1).max(100),
  starred: z.boolean(), // false = 取消收藏
  note: z.string().trim().max(500).nullish(),
});

/** 收藏 / 取消收藏评论 / 改备注：只接受同源请求；再次收藏不改收藏时间 */
export const onRequestPost: PagesFunction<Env> = async (c) => {
  const denied = crossOrigin(c.request);
  if (denied) return denied;
  const parsed = Body.safeParse(await c.request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const { reviewId, starred, note } = parsed.data;
  const w = feedbackDbFor(c.env);
  try {
    if (!starred) {
      await w.db.delete(favoriteReviews).where(eq(favoriteReviews.reviewId, reviewId));
      return Response.json({ ok: true, favorite: null });
    }
    const now = new Date();
    await w.db.insert(favoriteReviews)
      .values({ reviewId, note: note || null, email: accessEmail(c.request), createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: favoriteReviews.reviewId, set: { note: note || null, updatedAt: now } });
    return Response.json({ ok: true, favorite: { note: note || null } });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "保存失败" }, { status: 500 });
  } finally {
    c.waitUntil(w.close());
  }
};

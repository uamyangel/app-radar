import { favorites } from "@app-radar/shared";
import { eq } from "@app-radar/shared/orm";
import { z } from "zod";
import { api, AppId } from "../../_lib/api.ts";
import type { FavoriteResp } from "../../_lib/types.ts";

/** 某个 App 有没有收藏（详情页的按钮用）；不缓存，收藏完立刻能读到 */
export const onRequestGet = api(z.object({ id: AppId }), async (q, db): Promise<FavoriteResp> => {
  const [f] = await db.select().from(favorites).where(eq(favorites.appId, q.id));
  return { favorite: f ? { country: f.country, note: f.note, createdAt: f.createdAt.toISOString() } : null };
}, { cache: false });

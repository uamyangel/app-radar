import { seen } from "@app-radar/shared";
import { and, eq, inArray, sql } from "@app-radar/shared/orm";
import { z } from "zod";
import { api } from "../_lib/api.ts";
import { feedbackDbFor, type Env } from "../_lib/db.ts";
import { SEEN_KINDS, type SeenResp } from "../_lib/types.ts";
import { crossOrigin } from "../_lib/write.ts";

const Kind = z.enum(SEEN_KINDS);
const Key = z.string().min(1).max(100);

/** 这些卡片里哪些看过：keys 用逗号分隔（一页最多 200 张）。不缓存 */
export const onRequestGet = api(
  z.object({ kind: Kind, keys: z.string().max(8000).transform((s) => s.split(",").filter(Boolean)).pipe(z.array(Key).max(300)) }),
  async (q, db): Promise<SeenResp> => {
    if (q.keys.length === 0) return { seen: {} };
    const rows = await db.select({ key: seen.key, ver: seen.ver }).from(seen).where(and(eq(seen.kind, q.kind), inArray(seen.key, q.keys)));
    return { seen: Object.fromEntries(rows.map((r) => [r.key, r.ver])) };
  },
  { cache: false },
);

const Body = z.object({ items: z.array(z.object({ kind: Kind, key: Key, ver: z.string().max(40).nullable() })).min(1).max(300) });

/** 记下看过：页面攒一批再发（离开页面时也会发）。只接受同源请求 */
export const onRequestPost: PagesFunction<Env> = async (c) => {
  const denied = crossOrigin(c.request);
  if (denied) return denied;
  const parsed = Body.safeParse(await c.request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const now = new Date();
  const w = feedbackDbFor(c.env);
  try {
    // 同一批里同一张卡片可能出现两次，upsert 不允许，按最后一次去重
    const items = [...new Map(parsed.data.items.map((i) => [`${i.kind}\u0000${i.key}`, i])).values()];
    await w.db.insert(seen)
      .values(items.map((i) => ({ ...i, seenAt: now })))
      .onConflictDoUpdate({ target: [seen.kind, seen.key], set: { ver: sql`excluded.ver`, seenAt: now } });
    return Response.json({ ok: true });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "保存失败" }, { status: 500 });
  } finally {
    c.waitUntil(w.close());
  }
};

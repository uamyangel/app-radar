import assert from "node:assert/strict";
import { test } from "node:test";
import { isPeak } from "./llm.ts";

test("DeepSeek 高峰时段：周一至五 UTC 01–04、06–10 点", () => {
  const at = (iso: string) => isPeak(new Date(iso));
  assert.equal(at("2026-11-23T00:59:00Z"), false); // 周一，高峰前
  assert.equal(at("2026-11-23T01:00:00Z"), true);
  assert.equal(at("2026-11-23T03:59:00Z"), true);
  assert.equal(at("2026-11-23T04:00:00Z"), false); // 两段高峰之间
  assert.equal(at("2026-11-23T06:30:00Z"), true);
  assert.equal(at("2026-11-23T10:00:00Z"), false);
  assert.equal(at("2026-11-23T15:17:00Z"), false); // AI 定时（UTC 10:17）晚 5 小时，仍在非高峰
  assert.equal(at("2026-11-22T02:00:00Z"), false); // 周日全天非高峰
  assert.equal(at("2026-11-21T07:00:00Z"), false); // 周六全天非高峰
});

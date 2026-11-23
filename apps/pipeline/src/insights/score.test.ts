import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "@app-radar/shared/config";
import { computeMetrics, wilsonLb } from "./score.ts";

const cfg = loadConfig("config.yaml");
type Row = Parameters<typeof computeMetrics>[0][number];
const app = (o: Partial<Row>): Row => ({
  need_id: 1, country: "us", app_id: 1, mentions: 1, analyzed: 50, churn: 0, pay: 0, one_star: 0, developer_id: 1,
  weeks: ["2026-11-16"], best_rank: 30, on_grossing: false, tags: [], dev_type: "normal", review_avg: 3.5, genre_median: 3.5, name: "x", ...o,
});

test("Wilson 下界：小样本被压低，3 条里 2 条远低于 67%", () => {
  assert.ok(wilsonLb(2, 3) < 0.25);
  assert.ok(wilsonLb(200, 300) > 0.6);
  assert.equal(wilsonLb(0, 0), 0);
});

test("规模：100 条远强于 1 条，1000 条只比 100 条强一些（取对数、40 条封顶）", () => {
  const e = (n: number) => computeMetrics([app({ mentions: n, analyzed: n * 10 })], "missing_feature", cfg).evidence; // 浓度固定 10%，只比规模
  assert.ok(e(100) > e(1) * 3);
  assert.ok(e(1000) <= e(100) * 1.2);
});

test("同样条数，分散在 3 个 App 比集中在 1 个 App 的证据强", () => {
  const one = computeMetrics([app({ mentions: 9 })], "pricing", cfg);
  const three = computeMetrics([app({ app_id: 1, mentions: 3, developer_id: 1 }), app({ app_id: 2, mentions: 3, developer_id: 2 }), app({ app_id: 3, mentions: 3, developer_id: 3 })], "pricing", cfg);
  assert.ok(three.evidence > one.evidence);
});

test("主列表门槛：≥3 条且 ≥2 个 App；或单 App ≥5 条且浓度下界 ≥10%；只有 1 人提到的进待观察", () => {
  assert.equal(computeMetrics([app({ mentions: 1 })], "pricing", cfg).tier, "watch");
  assert.equal(computeMetrics([app({ app_id: 1, mentions: 2 }), app({ app_id: 2, mentions: 1, developer_id: 2 })], "pricing", cfg).tier, "main");
  assert.equal(computeMetrics([app({ mentions: 6, analyzed: 20 })], "pricing", cfg).tier, "main"); // 6/20 下界约 14%
  assert.equal(computeMetrics([app({ mentions: 6, analyzed: 2000 })], "pricing", cfg).tier, "watch"); // 浓度太低
});

test("可行性：崩溃类诉求远低于缺功能；对手全是大公司时略降", () => {
  const f = (kind: string, dev = "normal") => computeMetrics([app({ mentions: 5, dev_type: dev })], kind, cfg).feasibility;
  assert.ok(f("reliability") < f("missing_feature") / 2);
  assert.ok(f("missing_feature", "major") < f("missing_feature"));
});

test("缺口：承载 App 停更、用户想换掉时更高", () => {
  const base = computeMetrics([app({ mentions: 5 })], "pricing", cfg).gap;
  const stale = computeMetrics([app({ mentions: 5, tags: ["陈旧在榜"], churn: 3 })], "pricing", cfg).gap;
  assert.ok(stale > base + 0.3);
});

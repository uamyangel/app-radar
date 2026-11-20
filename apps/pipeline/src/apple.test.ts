import assert from "node:assert/strict";
import { test } from "node:test";
import { detectLang } from "@app-radar/shared";
import { parseLegacyChart, parseLookup, parseRssReviews, parseWebReviews } from "./apple.ts";

test("旧版榜单：entry 只有一条时是对象而不是数组", () => {
  const one = { feed: { entry: { id: { attributes: { "im:id": "123" } }, category: { attributes: { "im:id": "6007" } } } } };
  assert.deepEqual(parseLegacyChart(JSON.stringify(one)), [{ appId: 123, genreId: 6007 }]);
  assert.deepEqual(parseLegacyChart(JSON.stringify({ feed: {} })), []); // cn 新闻榜：没有 entry
});

test("RSS 评论：跳过没有评分的条目（App 自身信息）", () => {
  const feed = {
    feed: {
      entry: [
        { "im:name": { label: "Some App" }, id: { label: "999" } },
        {
          id: { label: "r1" }, "im:rating": { label: "2" }, title: { label: "t" }, content: { label: "c", attributes: { type: "text" } },
          author: { name: { label: "a" } }, "im:version": { label: "1.0" }, "im:voteSum": { label: "3" }, updated: { label: "2026-11-18T16:18:04-07:00" },
        },
      ],
    },
  };
  const r = parseRssReviews(JSON.stringify(feed));
  assert.equal(r.length, 1);
  assert.equal(r[0]!.reviewId, "r1");
  assert.equal(r[0]!.voteSum, 3);
  assert.equal(r[0]!.voteCount, null);
  assert.equal(r[0]!.reviewedAt.toISOString(), "2026-11-18T23:18:04.000Z");
});

test("网页评论：解析字段和是否有下一页", () => {
  const d = { next: "/v1/x?offset=20", data: [{ id: "5", type: "user-reviews", attributes: { date: "2026-11-19T10:00:00Z", rating: 1, title: "", review: "bad", userName: "u", isEdited: false } }] };
  const r = parseWebReviews(JSON.stringify(d));
  assert.equal(r.hasNext, true);
  assert.equal(r.items[0]!.title, null);
  assert.equal(r.items[0]!.appVersion, null);
  assert.equal(parseWebReviews(JSON.stringify({ data: [] })).hasNext, false);
});

test("lookup：单条不合法不影响其他条目，评分保留两位小数", () => {
  const d = { resultCount: 2, results: [{ wrapperType: "software", trackId: 1, trackName: "A", averageUserRating: 4.52711, genreIds: ["6007", "6000"], trackViewUrl: "https://apps.apple.com/us/app/a/id1?uo=4" }, { trackId: "bad" }] };
  const r = parseLookup(JSON.stringify(d));
  assert.equal(r.invalid, 1);
  assert.equal(r.apps[0]!.ratingAvg, 4.53);
  assert.deepEqual(r.apps[0]!.genreIds, [6007, 6000]);
  assert.equal(r.apps[0]!.storeUrl, "https://apps.apple.com/us/app/a/id1");
});

test("语言检测", () => {
  assert.equal(detectLang("このアプリは最高です"), "ja");
  assert.equal(detectLang("日本語の漢字だけ"), "ja"); // 含假名「の」「だけ」
  assert.equal(detectLang("封号毫无道理 订阅就封号"), "zh");
  assert.equal(detectLang("繁體中文評論很好用"), "zh");
  assert.equal(detectLang("Great app, love it"), "other");
  assert.equal(detectLang("kyc 别搞啊"), "zh");
  assert.equal(detectLang("❤️❤️❤️ 67"), "unknown");
  assert.equal(detectLang("ok"), "unknown");
});

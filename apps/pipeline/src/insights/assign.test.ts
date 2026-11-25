import assert from "node:assert/strict";
import { test } from "node:test";
import { assignBench } from "./assign.ts";

const { Out } = assignBench;

test("新建需求用负数编号，assign 里只有数字", () => {
  const out = Out.parse({
    assign: [{ s: 1, need: 45 }, { s: 2, need: -1 }, { s: 3, need: 0 }],
    new_needs: [{ key: -1, title: "需要导出 CSV", description: "", kind: "feature", object: "导出 CSV" }],
  });
  assert.deepEqual(out.assign.map((a) => a.need), [45, -1, 0]);
  assert.equal(out.new_needs[0]!.key, -1);
});

test("need 为 null 或不是整数时留空，不能变成 0（太空泛）", () => {
  const out = Out.parse({ assign: [{ s: 1, need: null }, { s: 2, need: "n1" }, { s: 3 }], new_needs: [] });
  assert.deepEqual(out.assign.map((a) => a.need), [null, null, null]);
});

test("new_needs 的 key 不是负数时整组丢弃，引用它的提法留到下一批", () => {
  const out = Out.parse({ assign: [{ s: 1, need: -1 }], new_needs: [{ key: "n1", title: "需要导出", kind: "feature" }] });
  assert.deepEqual(out.new_needs, []);
});

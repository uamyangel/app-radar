import assert from "node:assert/strict";
import { test } from "node:test";
import { isGeneric } from "./generic.ts";

test("和 App 做什么无关的类型一律算通用抱怨，即使措辞看似具体", () => {
  assert.equal(isGeneric("pricing", "取消订阅"), true);
  assert.equal(isGeneric("ads", "升级订阅弹窗"), true);
  assert.equal(isGeneric("reliability", "同步后数据丢失"), true);
  assert.equal(isGeneric("account_service", "退款"), true);
});

test("简洁、质量类：说出具体操作才算具体需求", () => {
  assert.equal(isGeneric("simplicity", "界面"), true);
  assert.equal(isGeneric("simplicity", ""), true);
  assert.equal(isGeneric("quality", "AI"), true);
  // 泛词加修饰语也算泛泛（第 3 版试点里漏掉的几个）
  for (const o of ["界面杂乱", "改版后导航", "内置AI功能", "被移除的功能", "使用教程"]) assert.equal(isGeneric("simplicity", o), true, o);
  assert.equal(isGeneric("simplicity", "添加编辑食品和食谱"), false);
  assert.equal(isGeneric("quality", "血压测量"), false);
  assert.equal(isGeneric("simplicity", "签到与开始运动流程"), false);
  assert.equal(isGeneric("simplicity", "手动录入步数"), false);
});

test("缺功能、平台、导入导出、本地化、隐私、内容：都是具体需求", () => {
  for (const k of ["missing_feature", "platform", "interop", "localization", "privacy", "content"]) assert.equal(isGeneric(k, ""), false, k);
});

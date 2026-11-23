import assert from "node:assert/strict";
import { test } from "node:test";
import { isAdaptation, isGeneric } from "./generic.ts";
import { loadConfig } from "@app-radar/shared/config";

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

test("新设备 / 新系统适配：现有 App 自己会补上的算，长期的平台空白不算（2026-11-23 主列表实例）", () => {
  const rule = loadConfig("config.yaml").insights.pipeline.adaptation;
  for (const [t, o] of [
    ["适配双屏折叠设备", "Surface Duo双屏设备"], ["适配 iPhone Duo", "iPhone Duo"], ["应用长期未更新，需适配新系统和设备", "新系统与新设备适配"],
    ["系统升级后保持兼容", "系统升级兼容"], ["希望继续支持旧系统和旧设备", "旧系统与旧设备支持"], ["新款 iPhone 上无法使用或测量", "新款iPhone"],
    ["界面适配不同尺寸手机", "手机屏幕"], ["希望适配新系统界面风格", "iOS液态玻璃界面"], ["兼容较低版本iOS", "iOS 16及更低版本"], ["适配折叠屏和分屏显示", "折叠屏和分屏"],
    ["兼容更低版本iOS", "iOS"], ["快捷指令兼容旧系统", "旧系统"], ["兼容最新版鸿蒙系统", "鸿蒙"],
  ]) assert.equal(isAdaptation("platform", t!, o, rule), true, t!);
  for (const [t, o] of [
    ["希望有 Apple Watch 版应用", "Apple Watch版应用"], ["提供适配iPad的版本", "iPad"], ["希望支持 Mac", "Mac"], ["希望提供主屏幕小组件", "主屏幕小组件"],
    ["希望支持iCloud等其他同步方式", "iCloud同步"], ["希望恢复或支持更多平台版本", "安卓版"], ["换机后完整保留数据", "换机数据迁移"], ["希望支持深色模式", "深色模式"],
    // 「兼容」单独出现太宽：这几条是功能或互通，不是新设备适配
    ["兼容家长控制过滤工具", "家长控制过滤工具"], ["兼容更多车型", "车型"], ["多部手机应兼容同一电视", "电视"],
  ]) assert.equal(isAdaptation("platform", t!, o, rule), false, t!);
  assert.equal(isAdaptation("missing_feature", "适配 iPhone Duo", "iPhone Duo", rule), false);
});

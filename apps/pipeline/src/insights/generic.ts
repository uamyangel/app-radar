/**
 * 「通用抱怨」判定：完全由程序按诉求类型决定，结果可复现，不需要模型判断。
 * 通用抱怨的本质是「和 App 做什么无关」：取消订阅难、广告多、崩溃、客服差在任何品类都一样。
 * 它对应的机会是「同类产品的更良心版本」（商业模式和体验的差异化），应该落到具体 App 上看，不作为独立的需求卡片。
 *
 * 演进记录：
 *   1. 让模型直接判断是否通用 → 边界不稳定，「基础功能不应强制付费」写进规则后仍被判为具体需求
 *   2. 让模型说出具体对象、泛词黑名单兜底 → 模型总能给出看似具体的短语（「取消订阅」「升级订阅弹窗」），黑名单拦不住
 *   3. 按诉求类型判定（当前）
 */

/** 不算「具体对象」的泛词（归一化后比较：去空格、小写） */
const VAGUE = new Set([
  "基础功能", "核心功能", "功能", "全部功能", "部分功能", "免费功能", "付费功能", "高级功能", "主要功能", "常用功能", "新功能", "细节功能",
  "内容", "免费内容", "会员", "会员权益", "服务", "额度", "免费额度", "次数", "积分", "价格", "订阅", "付费", "收费",
  "广告", "开屏广告", "弹窗", "ai", "ai功能", "结果", "数据", "体验", "界面", "设计", "应用", "app", "软件", "客服", "退款", "售后",
  "使用", "操作", "流程", "性能", "速度", "稳定性", "bug", "问题", "更新", "版本",
  "导航", "菜单", "布局", "教程", "引导", "说明", "设置", "选项", "提示", "通知", "页面", "首页",
]);
/** 修饰语：先去掉再判断剩下的是不是泛词（「界面杂乱」→「界面」，「内置AI功能」→「AI功能」） */
const MODIFIERS = [
  "改版后", "新版", "旧版", "被移除的", "被删除的", "移除的", "删除的", "内置的", "内置", "太多的", "太多", "过多", "太少",
  "杂乱", "混乱", "复杂", "繁琐", "难找", "难用", "不好用", "不准确", "不准", "简洁", "简单", "清爽", "的", "和", "与", "及",
];
const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** 对象为空或是泛词 */
const VAGUE_LONGEST_FIRST = [...VAGUE].sort((a, b) => b.length - a.length);

/** 去掉修饰语和泛词之后，剩下的不足 2 个字就算泛泛（「使用教程」→ 空；「签到与开始运动流程」→「签到开始运动」） */
export function isVague(object: string | null | undefined): boolean {
  let o = object ? norm(object) : "";
  for (const m of MODIFIERS) o = o.split(m).join("");
  for (const v of VAGUE_LONGEST_FIRST) o = o.split(v).join("");
  return o.length < 2;
}

/** 和 App 做什么无关的类型：一律通用 */
const ALWAYS_GENERIC = new Set(["pricing", "ads", "account_service", "reliability", "performance", "other"]);
/** 可能具体、也可能泛泛的类型：说出具体对象才算具体需求 */
const NEEDS_OBJECT = new Set(["simplicity", "quality"]);

export function isGeneric(kind: string, object: string | null | undefined): boolean {
  if (ALWAYS_GENERIC.has(kind)) return true;
  if (NEEDS_OBJECT.has(kind)) return isVague(object);
  return false; // 缺功能、平台空白、导入导出、本地化、隐私、内容：都是具体需求
}

export const OBJECT_RULE = `object：这个需求针对的「具体对象」，用几个字写出是哪个功能、操作、场景、格式、设备或人群，例如「导出 PDF」「扫描页数」「Apple Watch」「多家诊所的诊察券」「添加食谱」「折叠屏」「苹果健康同步」。
如果需求没有说清具体对象（只是泛泛地说贵、广告多、不准、崩溃、客服差、功能少、太复杂、基础功能要付费、免费额度少），object 写空字符串。
不要把「基础功能」「会员」「额度」「AI」「广告」「内容」「功能」这类泛词当作具体对象。`;

/**
 * 新设备 / 新系统适配：「适配 iPhone Duo」「系统升级后保持兼容」「继续支持旧系统」。
 * 需求的实质是现有 App 还没跟上平台变化，通常过一段时间会自己补上，个人开发者没法靠这个切入。
 * 只看平台空白类；没有 iPad / Watch / Mac 版、小组件这类长期空白是真机会，不算在内。
 */
export function isAdaptation(kind: string, title: string, object: string | null | undefined, rule: { pattern: string; except: string }): boolean {
  if (kind !== "platform") return false;
  const text = `${title} ${object ?? ""}`;
  return new RegExp(rule.pattern, "i").test(text) && !new RegExp(rule.except, "i").test(text);
}

/**
 * 评论归类体系（固定，便于跨 App、跨品类统计和比较）。
 * code 存库，label 给页面显示，hint 写进提示词帮助模型判断。
 */
export const TOPICS = {
  crash: { label: "崩溃/闪退", hint: "闪退、打不开、白屏、无响应" },
  performance: { label: "卡顿/耗电", hint: "慢、卡、发热、耗电、占空间" },
  bug: { label: "功能故障", hint: "某个功能不能正常工作、报错、结果不对" },
  account: { label: "登录/账号", hint: "登录不了、验证码、封号、账号丢失、注销难" },
  pricing: { label: "收费/订阅", hint: "太贵、订阅陷阱、扣费、免费版限制多、付费墙" },
  ads: { label: "广告", hint: "广告多、强制看广告、误导点击" },
  missing: { label: "缺少功能", hint: "希望增加某功能、缺少某种支持" },
  regression: { label: "更新后变差", hint: "新版本去掉或改坏了原有功能、改版难用" },
  usability: { label: "不好用", hint: "操作复杂、界面混乱、难上手、交互别扭" },
  quality: { label: "内容/结果质量", hint: "内容少或差、AI 回答不准、识别不准、效果差" },
  data: { label: "数据丢失/同步", hint: "数据丢失、同步失败、备份恢复问题" },
  privacy: { label: "隐私/权限", hint: "索要过多权限、隐私担忧、骚扰" },
  support: { label: "客服/退款", hint: "客服不回应、退款难、投诉无门" },
  compat: { label: "设备兼容", hint: "某设备或系统版本不支持、适配差、iPad 体验差" },
  praise: { label: "好评", hint: "满意、推荐、感谢（没有具体问题时才用）" },
  other: { label: "其他", hint: "以上都不合适" },
} as const;
export type Topic = keyof typeof TOPICS;
export const TOPIC_CODES = Object.keys(TOPICS) as Topic[];

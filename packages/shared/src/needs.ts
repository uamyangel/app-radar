/** 诉求类型（提取提法、归并需求、页面显示共用） */
export const KINDS = {
  missing_feature: "缺少某个功能或流程",
  simplicity: "太复杂、难上手，想要更简单的",
  pricing: "收费模式不满：订阅太贵、想要买断、免费版限制太多、扣费不透明",
  ads: "广告太多、太打扰",
  platform: "平台空白：iPad、Mac、手表、小组件、离线、跨设备同步",
  localization: "语言、地区、本地化不好",
  privacy: "隐私顾虑，想要纯本地、不上传",
  interop: "导入导出、和其他工具或格式互通",
  quality: "内容或结果质量差（AI 不准、识别不准、内容少）",
  performance: "慢、卡、耗电、占空间",
  reliability: "崩溃、bug、数据丢失、同步出错",
  account_service: "账号、登录、封号、客服、退款等平台服务问题",
  content: "缺少有版权的内容（影视、音乐、书）",
  other: "以上都不合适",
} as const;

/** 页面上显示的简称 */
export const KIND_SHORT: Record<string, string> = {
  missing_feature: "缺功能", simplicity: "太复杂", pricing: "收费模式", ads: "广告", platform: "平台空白",
  localization: "本地化", privacy: "隐私", interop: "导入导出", quality: "质量", performance: "性能",
  reliability: "稳定性", account_service: "账号客服", content: "内容版权", other: "其他",
};

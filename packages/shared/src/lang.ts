/**
 * 评论语言的本地规则检测（SPEC 7.1）：
 *   含假名 → ja；以汉字为主且无假名 → zh；有足够拉丁/其他文字 → other；
 *   判断不了（只有 emoji、数字、极短）→ unknown，交给大模型翻译时一并判断。
 */
export type Lang = "zh" | "ja" | "other" | "unknown";

const KANA = /[぀-ゟ゠-ヿㇰ-ㇿｦ-ﾟ]/g;
const HAN = /[㐀-䶿一-鿿豈-﫿]/g;
const LETTER = /\p{L}/gu;

export function detectLang(text: string): Lang {
  const kana = text.match(KANA)?.length ?? 0;
  const han = text.match(HAN)?.length ?? 0;
  const letters = text.match(LETTER)?.length ?? 0;
  if (kana > 0) return "ja";
  if (letters < 2) return "unknown";
  if (han / letters >= 0.5) return "zh";
  if (letters - han >= 3) return "other";
  return "unknown";
}

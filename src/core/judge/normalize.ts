/**
 * 判对错前的文本归一化（需求 5.4 中“视为相同”的前几条）：
 * 大小写、首尾与连续空格、句末标点、直弯引号、连字符与空格、句中逗号。
 */

const APOSTROPHES = /[\u2018\u2019\u02BC\u0060\u00B4]/g;
const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u00AB\u00BB]/g;
const HYPHENS = /[-\u2010\u2011\u2012\u2013\u2014]/g;
const TRAILING_PUNCTUATION = /[.!?;:,…\s]+$/;

/** 统一引号写法，不改变大小写 */
export function straightenQuotes(text: string): string {
  return text.replace(APOSTROPHES, "'").replace(DOUBLE_QUOTES, '"');
}

/**
 * 切成用于展示的词：保留用户原本的大小写，
 * 但已去掉逗号、句末标点，并把连字符当作空格。
 */
export function displayTokens(text: string): string[] {
  const cleaned = straightenQuotes(text)
    .replace(TRAILING_PUNCTUATION, "")
    .replace(/,/g, " ")
    .replace(HYPHENS, " ")
    .trim();
  return cleaned.length === 0 ? [] : cleaned.split(/\s+/);
}

/** 词数（句块长度校验用）：按空白切分，连字符连接的算一个词 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/** 原形的去重键：忽略大小写、引号写法和多余空格 */
export function lemmaKey(lemma: string): string {
  return straightenQuotes(lemma).toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * 按规则把正文切分为段落和句子（需求 3.3 第 1 步）。纯规则，不调用 AI。
 * 正文约定为“空行分段、段内无换行”的规范形式，见 normalizeArticleText。
 */

export interface Paragraph {
  idx: number;
  text: string;
  start: number;
  end: number;
}

export interface Sentence {
  /** 全文内从 0 开始的编号 */
  idx: number;
  paragraphIdx: number;
  text: string;
  /** 在全文中的起止下标（end 不含） */
  start: number;
  end: number;
}

/** 后面一定跟着名字或数字，句点不结束句子 */
const NEVER_TERMINAL = new Set([
  "mr",
  "mrs",
  "ms",
  "mx",
  "dr",
  "prof",
  "st",
  "sr",
  "sra",
  "mme",
  "mlle",
  "messrs",
  "gen",
  "col",
  "lt",
  "sgt",
  "capt",
  "cmdr",
  "adm",
  "maj",
  "cpl",
  "pvt",
  "rev",
  "hon",
  "gov",
  "sen",
  "rep",
  "pres",
  "supt",
  "det",
  "fr",
  "vs",
  "v",
  "cf",
  "viz",
  "ca",
  "approx",
  "est",
  "no",
  "nos",
  "vol",
  "vols",
  "fig",
  "figs",
  "p",
  "pp",
  "ch",
  "sec",
  "eq",
  "ed",
  "eds",
  "trans",
  "al",
  "mt",
  "ft",
  "e.g",
  "i.e",
  "eg",
  "ie",
]);

/** 可能出现在句末的缩写：只有后面是常见句首词时才断句 */
const MAYBE_TERMINAL = new Set([
  "etc",
  "inc",
  "ltd",
  "co",
  "corp",
  "jr",
  "bros",
  "dept",
  "univ",
  "assn",
  "ave",
  "blvd",
  "rd",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
  "mon",
  "tue",
  "tues",
  "wed",
  "thu",
  "thur",
  "thurs",
  "fri",
  "sat",
  "sun",
  "a.m",
  "p.m",
  "u.s",
  "u.k",
  "u.n",
  "e.u",
  "ph.d",
  "m.d",
  "b.a",
  "m.a",
  "d.c",
]);

const SENTENCE_STARTERS = new Set([
  "the",
  "a",
  "an",
  "it",
  "he",
  "she",
  "they",
  "we",
  "i",
  "you",
  "this",
  "that",
  "these",
  "those",
  "there",
  "here",
  "in",
  "on",
  "at",
  "for",
  "by",
  "with",
  "from",
  "to",
  "of",
  "as",
  "if",
  "when",
  "while",
  "after",
  "before",
  "since",
  "until",
  "although",
  "though",
  "because",
  "but",
  "and",
  "or",
  "so",
  "yet",
  "however",
  "moreover",
  "meanwhile",
  "still",
  "then",
  "now",
  "today",
  "its",
  "his",
  "her",
  "their",
  "our",
  "my",
  "your",
  "what",
  "why",
  "how",
  "who",
  "where",
  "which",
  "some",
  "many",
  "most",
  "all",
  "each",
  "every",
  "both",
  "no",
  "not",
  "one",
  "two",
  "under",
  "over",
  "during",
  "despite",
  "according",
  "last",
  "next",
  "also",
  "thus",
  "indeed",
  "instead",
]);

const CLOSERS = new Set(['"', "”", "’", "'", ")", "]", "»"]);
const OPENERS = new Set(['"', "“", "‘", "'", "(", "[", "«"]);

function isSpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\n" || ch === "\t";
}

/** 取句点之前的那个“词”（去掉开头的引号和括号），小写 */
function tokenBefore(text: string, dot: number): string {
  let start = dot;
  while (start > 0 && !isSpace(text[start - 1])) start--;
  let token = text.slice(start, dot);
  while (token.length > 0 && OPENERS.has(token[0] ?? "")) token = token.slice(1);
  return token;
}

function nextWord(text: string, from: number): string {
  let i = from;
  while (i < text.length && OPENERS.has(text[i] ?? "")) i++;
  let end = i;
  while (end < text.length && /[A-Za-z']/.test(text[end] ?? "")) end++;
  return text.slice(i, end);
}

function startsSentence(text: string, from: number): boolean {
  let i = from;
  while (i < text.length && OPENERS.has(text[i] ?? "")) i++;
  const ch = text[i];
  return ch !== undefined && /[A-Z0-9]/.test(ch);
}

/** 句点是否结束句子。dot 是句点下标，after 是句点（及后续引号）之后第一个非空白字符的下标 */
function periodEndsSentence(text: string, dot: number, after: number): boolean {
  const token = tokenBefore(text, dot);
  const lower = token.toLowerCase();

  if (NEVER_TERMINAL.has(lower)) return false;
  // 段首的列表序号，如 “1. First”
  if (/^\d{1,2}$/.test(token) && text.slice(0, dot - token.length).trim().length === 0)
    return false;
  // 姓名首字母，如 “J. K. Rowling”
  if (/^[A-Z]$/.test(token)) return false;

  const dotted = /^([a-z]\.)+[a-z]$/i.test(token);
  if (MAYBE_TERMINAL.has(lower) || dotted) {
    return SENTENCE_STARTERS.has(nextWord(text, after).toLowerCase());
  }
  return true;
}

function splitParagraphIntoSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch !== "." && ch !== "!" && ch !== "?" && ch !== "…") {
      i++;
      continue;
    }
    // 吃掉连续的终止符（?!、...）和紧随其后的引号、括号
    let end = i + 1;
    while (end < text.length && /[.!?…]/.test(text[end] ?? "")) end++;
    while (end < text.length && CLOSERS.has(text[end] ?? "")) end++;

    if (end >= text.length) break;
    if (!isSpace(text[end])) {
      i = end;
      continue;
    }
    let after = end;
    while (after < text.length && isSpace(text[after])) after++;
    if (after >= text.length) break;

    const singlePeriod = ch === "." && !/[.!?…]/.test(text[i + 1] ?? "");
    let boundary = startsSentence(text, after);
    if (boundary && singlePeriod) boundary = periodEndsSentence(text, i, after);

    if (boundary) {
      spans.push([start, end]);
      start = after;
    }
    i = after;
  }
  if (start < text.length) spans.push([start, text.length]);
  return spans;
}

export function splitParagraphs(text: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const pattern = /\n[ \t]*\n+/g;
  let start = 0;
  const push = (from: number, to: number) => {
    const raw = text.slice(from, to);
    const trimmedStart = from + (raw.length - raw.trimStart().length);
    const body = raw.trim();
    if (body.length > 0) {
      paragraphs.push({
        idx: paragraphs.length,
        text: body,
        start: trimmedStart,
        end: trimmedStart + body.length,
      });
    }
  };
  for (const match of text.matchAll(pattern)) {
    push(start, match.index);
    start = match.index + match[0].length;
  }
  push(start, text.length);
  return paragraphs;
}

export function segmentSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  for (const paragraph of splitParagraphs(text)) {
    for (const [from, to] of splitParagraphIntoSpans(paragraph.text)) {
      const body = paragraph.text.slice(from, to);
      const lead = body.length - body.trimStart().length;
      const trimmed = body.trim();
      if (trimmed.length === 0) continue;
      const start = paragraph.start + from + lead;
      sentences.push({
        idx: sentences.length,
        paragraphIdx: paragraph.idx,
        text: trimmed,
        start,
        end: start + trimmed.length,
      });
    }
  }
  return sentences;
}

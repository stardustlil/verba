/**
 * AI 抽取结果的规则校验（需求 3.4）。不合格的条目丢弃，并记录原因。
 */
import { countWords, lemmaKey, straightenQuotes } from "../judge/normalize";
import type { Candidate, Rejected, SourceSentence } from "./types";

export const MIN_WORDS = 2;
export const MAX_WORDS = 8;

const LEADING_JUNK = /^[\s"“”([]+/;
const TRAILING_JUNK = /[\s"“”)\].,;:!?…]+$/;

/** 逐字符归一化，长度不变，便于把匹配位置映射回原文 */
function comparable(text: string): string {
  let out = "";
  for (const ch of straightenQuotes(text)) {
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9]/.test(ch);
}

/** 位置 index 处是否在一个词的内部（含连字符、撇号连接的情况） */
function insideWord(text: string, index: number): boolean {
  const before = text[index - 1];
  const at = text[index];
  if (isWordChar(before) && isWordChar(at)) return true;
  if ((before === "-" || before === "'") && isWordChar(at) && isWordChar(text[index - 2]))
    return true;
  if ((at === "-" || at === "'") && isWordChar(before) && isWordChar(text[index + 1])) return true;
  return false;
}

/**
 * 在句子中找出原文形式的位置。忽略大小写和引号写法，但必须是完整的词。
 * 找不到返回 null；出现多次时取第一处。
 */
export function locateSurface(
  sentence: string,
  text: string,
): { start: number; end: number } | null {
  const needle = comparable(
    text.replace(LEADING_JUNK, "").replace(TRAILING_JUNK, "").replace(/\s+/g, " "),
  );
  if (needle.length === 0) return null;
  const haystack = comparable(sentence);
  let from = 0;
  for (;;) {
    const start = haystack.indexOf(needle, from);
    if (start < 0) return null;
    const end = start + needle.length;
    if (!insideWord(haystack, start) && !insideWord(haystack, end)) return { start, end };
    from = start + 1;
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export interface ValidationResult {
  candidates: Candidate[];
  rejected: Rejected[];
}

/**
 * @param items     AI 返回的条目
 * @param sentences 这一批的句子，条目中的 s 是批内序号（从 1 开始）
 * @param ignored   忽略名单中的原形去重键
 */
export function validateCandidates(
  items: unknown[],
  sentences: SourceSentence[],
  ignored: ReadonlySet<string> = new Set(),
): ValidationResult {
  const candidates: Candidate[] = [];
  const rejected: Rejected[] = [];
  const seen = new Set<string>();

  for (const raw of items) {
    const item = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const text = asString(item.text);
    const lemma = asString(item.lemma)?.replace(/\s+/g, " ");
    const meaning = asString(item.zh);
    const number = typeof item.s === "number" ? item.s : Number.NaN;
    if (!text || !lemma || !meaning || !Number.isInteger(number)) {
      rejected.push({ reason: "malformed", raw });
      continue;
    }
    const sentence = sentences[number - 1];
    if (!sentence) {
      rejected.push({ reason: "bad-sentence", raw });
      continue;
    }
    const span = locateSurface(sentence.text, text);
    if (!span) {
      rejected.push({ reason: "not-verbatim", raw });
      continue;
    }
    const surface = sentence.text.slice(span.start, span.end);
    const surfaceWords = countWords(surface);
    const lemmaWords = countWords(lemma);
    if (
      surfaceWords < MIN_WORDS ||
      surfaceWords > MAX_WORDS ||
      lemmaWords < MIN_WORDS ||
      lemmaWords > MAX_WORDS
    ) {
      rejected.push({ reason: "length", raw });
      continue;
    }
    const key = lemmaKey(lemma);
    if (ignored.has(key)) {
      rejected.push({ reason: "ignored", raw });
      continue;
    }
    const dedupe = `${sentence.idx}\n${key}`;
    if (seen.has(dedupe)) {
      rejected.push({ reason: "duplicate", raw });
      continue;
    }
    seen.add(dedupe);
    candidates.push({
      sentenceIdx: sentence.idx,
      surface,
      start: span.start,
      lemma,
      lemmaKey: key,
      meaning,
    });
  }
  return { candidates, rejected };
}

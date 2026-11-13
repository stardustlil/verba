/**
 * 导入文本的自动清理（需求 2.2）：合并被硬换行断开的句子、修复跨行断词、去除多余空白。
 * 输出的正文以空行分隔段落，段内不含换行。
 */

export type LineBreakMode =
  /** 自动判断是否为硬换行文本（如从 PDF 复制） */
  | "auto"
  /** 单个换行一律视为段内换行（Markdown） */
  | "join"
  /** 每个换行都是段落边界（网页正文） */
  | "paragraph";

export interface HyphenJoin {
  /** 合并后的词在清理后正文中的起始下标 */
  offset: number;
  /** 合并后的词，如 widespread */
  word: string;
}

export interface CleanResult {
  text: string;
  /** 被自动合并的跨行断词，供预览时提示用户检查 */
  joins: HyphenJoin[];
}

const ODD_SPACES = /[\t\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
const INVISIBLE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;
const TERMINAL = /[.!?:;…"”’')\]]$/;
const HYPHEN_END = /[A-Za-z]-$/;
const WORD_CHAR = /[A-Za-z0-9'’-]/;

/** 行宽不超过这个值才可能是硬换行文本 */
const MAX_WRAP_WIDTH = 120;
/** 短于典型行宽的这个比例，视为“短行”（段落末行或标题） */
const SHORT_LINE_RATIO = 0.6;

function normalizeLine(line: string): string {
  return line.replace(INVISIBLE, "").replace(ODD_SPACES, " ").replace(/ {2,}/g, " ").trim();
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index] ?? 0;
}

type Glue = "paragraph" | "space" | "dehyphenate" | "none";

function glueBetween(line: string, next: string, mode: LineBreakMode, wrapWidth: number): Glue {
  if (mode === "paragraph") return "paragraph";
  const hardWrapped = mode === "join" || wrapWidth <= MAX_WRAP_WIDTH;
  if (!hardWrapped) return "paragraph";

  if (HYPHEN_END.test(line)) {
    // wide-\nspread → widespread；non-\nEuropean 这类保留连字符
    if (/^[a-z]/.test(next)) return "dehyphenate";
    if (/^[A-Z]/.test(next)) return "none";
  }
  if (mode === "join") return "space";

  const short = line.length < wrapWidth * SHORT_LINE_RATIO;
  if (!short) return "space";
  if (TERMINAL.test(line)) return "paragraph";
  // 没有句末标点的短行：下一行小写开头则仍是同一句，否则当作标题
  return /^[a-z]/.test(next) ? "space" : "paragraph";
}

function wordAround(text: string, index: number): { start: number; word: string } {
  let start = index;
  while (start > 0 && WORD_CHAR.test(text[start - 1] ?? "")) start--;
  let end = index;
  while (end < text.length && WORD_CHAR.test(text[end] ?? "")) end++;
  return { start, word: text.slice(start, end) };
}

export function cleanText(raw: string, mode: LineBreakMode = "auto"): CleanResult {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n").map(normalizeLine);
  const wrapWidth = percentile(
    lines.filter((l) => l.length > 0).map((l) => l.length),
    0.9,
  );

  const paragraphs: string[] = [];
  /** 每段内被去掉连字符的位置 */
  const joinPoints: number[][] = [];
  let current = "";
  let currentJoins: number[] = [];

  const flush = () => {
    if (current.length > 0) {
      paragraphs.push(current);
      joinPoints.push(currentJoins);
    }
    current = "";
    currentJoins = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.length === 0) {
      flush();
      continue;
    }
    current += line;
    const next = lines[i + 1];
    if (next === undefined || next.length === 0) continue;
    const glue = glueBetween(line, next, mode, wrapWidth);
    if (glue === "paragraph") {
      flush();
    } else if (glue === "space") {
      current += " ";
    } else if (glue === "dehyphenate") {
      current = current.slice(0, -1);
      currentJoins.push(current.length);
    }
    // "none"：保留连字符，直接接下一行
  }
  flush();

  const joins: HyphenJoin[] = [];
  let offset = 0;
  paragraphs.forEach((paragraph, p) => {
    for (const point of joinPoints[p] ?? []) {
      const { start, word } = wordAround(paragraph, point);
      joins.push({ offset: offset + start, word });
    }
    offset += paragraph.length + 2;
  });

  return { text: paragraphs.join("\n\n"), joins };
}

/**
 * 把用户在预览中编辑过的正文整理成规范形式：
 * 空行分段，段内换行并为空格，去掉多余空白。
 */
export function normalizeArticleText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((paragraph) => normalizeLine(paragraph.replace(/\n/g, " ")))
    .filter((paragraph) => paragraph.length > 0)
    .join("\n\n");
}

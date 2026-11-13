/**
 * 三种导入方式（需求 2.1）各自把输入变成待预览的草稿：标题 + 清理后的正文。
 * 全部是规则处理，不调用 AI。
 */
import { Readability } from "@mozilla/readability";
import { type HyphenJoin, cleanText } from "../../core/text/clean";
import { stripMarkdown } from "../../core/text/markdown";
import { splitParagraphs } from "../../core/text/segment";
import type { SourceType } from "../../repo/articles";

export interface Draft {
  title: string;
  sourceType: SourceType;
  sourceRef: string | null;
  /** 清理后的正文：空行分段 */
  text: string;
  /** 被自动合并的跨行断词，预览时提示用户检查 */
  joins: HyphenJoin[];
}

const TITLE_MAX = 60;

function titleFromText(text: string): string {
  const first = splitParagraphs(text)[0]?.text ?? "";
  if (first.length <= TITLE_MAX) return first;
  const cut = first.slice(0, TITLE_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > 20 ? cut.slice(0, lastSpace) : cut}…`;
}

function requireText(text: string): string {
  if (text.trim().length === 0) throw new Error("没有可导入的文字");
  return text;
}

export function draftFromPaste(raw: string): Draft {
  const { text, joins } = cleanText(raw);
  requireText(text);
  return { title: titleFromText(text), sourceType: "paste", sourceRef: null, text, joins };
}

export function draftFromFile(name: string, content: string): Draft {
  const markdown = /\.(md|markdown)$/i.test(name);
  const { text, joins } = markdown ? cleanText(stripMarkdown(content), "join") : cleanText(content);
  requireText(text);
  return {
    title: name.replace(/\.[^.]+$/, "") || titleFromText(text),
    sourceType: "file",
    sourceRef: name,
    text,
    joins,
  };
}

const BLOCKS = "p, h1, h2, h3, h4, h5, h6, li, blockquote";
/** 正文少于这么多字符时认为提取失败 */
const MIN_ARTICLE_CHARS = 200;

/**
 * 用 Readability 从网页 HTML 中提取正文。
 * HTML 只交给 DOMParser 解析成不会执行脚本的文档，最终只取纯文本。
 */
export function draftFromHtml(html: string, url: string): Draft {
  const failure = new Error("没能从这个网页提取出正文，请改用粘贴文本");
  const document = new DOMParser().parseFromString(html, "text/html");
  const article = new Readability(document).parse();
  if (!article?.content) throw failure;

  const body = new DOMParser().parseFromString(article.content, "text/html").body;
  // 去掉脚注引用标记，如维基百科正文里的 [2][3]
  for (const sup of body.querySelectorAll("sup")) {
    if (sup.querySelector("a") !== null) sup.remove();
  }
  const paragraphs = [...body.querySelectorAll(BLOCKS)]
    .filter((element) => element.querySelector(BLOCKS) === null)
    .map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0);
  const raw = paragraphs.length > 0 ? paragraphs.join("\n") : (article.textContent ?? "");

  const { text } = cleanText(raw, "paragraph");
  if (text.length < MIN_ARTICLE_CHARS) throw failure;
  return {
    title: article.title?.trim() || titleFromText(text),
    sourceType: "url",
    sourceRef: url,
    text,
    joins: [],
  };
}

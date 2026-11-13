/** 文章详情：把一段文字按短语高亮切开，并把页面上的选区换算回全文位置 */

export interface Span {
  start: number;
  end: number;
}

export interface Segment<H> {
  /** 在全文中的起点 */
  start: number;
  text: string;
  highlight: H | null;
}

/**
 * 按高亮切分一段文字。highlights 的 start 为全文位置；
 * 互相重叠的高亮只保留先出现的那个。
 */
export function segmentParagraph<H extends Span>(
  paragraph: { text: string; start: number },
  highlights: readonly H[],
): Segment<H>[] {
  const end = paragraph.start + paragraph.text.length;
  const sorted = highlights
    .filter((h) => h.start >= paragraph.start && h.end <= end && h.end > h.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const segments: Segment<H>[] = [];
  let cursor = paragraph.start;
  const slice = (from: number, to: number) =>
    paragraph.text.slice(from - paragraph.start, to - paragraph.start);
  for (const h of sorted) {
    if (h.start < cursor) continue;
    if (h.start > cursor)
      segments.push({ start: cursor, text: slice(cursor, h.start), highlight: null });
    segments.push({ start: h.start, text: slice(h.start, h.end), highlight: h });
    cursor = h.end;
  }
  if (cursor < end) segments.push({ start: cursor, text: slice(cursor, end), highlight: null });
  return segments;
}

/** 去掉选区两端的空白和标点外的空格 */
export function trimSpan(text: string, span: Span): Span | null {
  let { start, end } = span;
  if (start > end) [start, end] = [end, start];
  while (start < end && /\s/.test(text[start] ?? "")) start++;
  while (end > start && /\s/.test(text[end - 1] ?? "")) end--;
  return end > start ? { start, end } : null;
}

const WORD_CHAR = /[\p{L}\p{N}'’-]/u;

/** 选区两端落在单词中间时，扩展到整个单词（拖选时常常少选或多选一两个字母） */
export function snapToWords(text: string, span: Span): Span {
  let { start, end } = span;
  const isWord = (i: number) => WORD_CHAR.test(text[i] ?? "");
  while (start > 0 && isWord(start - 1) && isWord(start)) start--;
  while (end < text.length && isWord(end - 1) && isWord(end)) end++;
  return { start, end };
}

/** 选区所在的句子；跨句子时返回 null */
export function sentenceContaining<S extends Span>(sentences: readonly S[], span: Span): S | null {
  return sentences.find((s) => span.start >= s.start && span.end <= s.end) ?? null;
}

/** 页面上的一个位置（节点 + 偏移）对应的全文位置。文字都放在带 data-offset 的元素里。 */
function pointOffset(node: Node, offset: number): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const holder = node.parentElement?.closest<HTMLElement>("[data-offset]");
    if (!holder) return null;
    return Number(holder.dataset.offset) + offset;
  }
  if (node instanceof HTMLElement) {
    // 落在元素边界上：取第 offset 个子节点的开头，或最后一个子节点的末尾
    const child = node.childNodes[offset];
    if (child) {
      const holder =
        child instanceof HTMLElement
          ? (child.closest<HTMLElement>("[data-offset]") ??
            child.querySelector<HTMLElement>("[data-offset]"))
          : child.parentElement?.closest<HTMLElement>("[data-offset]");
      if (holder) return Number(holder.dataset.offset);
    }
    const holders = node.querySelectorAll<HTMLElement>("[data-offset]");
    const last = holders[holders.length - 1];
    if (last) return Number(last.dataset.offset) + (last.textContent?.length ?? 0);
  }
  return null;
}

/** 当前选区在全文中的位置；选区不在 container 内时返回 null */
export function selectionSpan(container: HTMLElement): Span | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const start = pointOffset(range.startContainer, range.startOffset);
  const end = pointOffset(range.endContainer, range.endOffset);
  if (start === null || end === null) return null;
  return { start, end };
}

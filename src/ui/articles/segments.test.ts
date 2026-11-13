// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  segmentParagraph,
  selectionSpan,
  sentenceContaining,
  snapToWords,
  trimSpan,
} from "./segments";

describe("segmentParagraph", () => {
  const paragraph = { text: "He has drawn wide attention today.", start: 100 };
  it("按高亮切开，位置为全文位置", () => {
    const h = { start: 107, end: 127, id: "a" };
    const segments = segmentParagraph(paragraph, [h]);
    expect(segments.map((s) => [s.start, s.text, s.highlight?.id ?? null])).toEqual([
      [100, "He has ", null],
      [107, "drawn wide attention", "a"],
      [127, " today.", null],
    ]);
  });
  it("重叠的高亮只保留先出现的；段外的忽略", () => {
    const segments = segmentParagraph(paragraph, [
      { start: 113, end: 127 },
      { start: 107, end: 117 },
      { start: 0, end: 5 },
    ]);
    expect(segments.filter((s) => s.highlight).map((s) => s.text)).toEqual(["drawn wide"]);
  });
  it("没有高亮", () => {
    expect(segmentParagraph(paragraph, [])).toEqual([
      { start: 100, text: paragraph.text, highlight: null },
    ]);
  });
});

describe("选区", () => {
  it("去掉两端空白", () => {
    expect(trimSpan("a  bc d", { start: 1, end: 6 })).toEqual({ start: 3, end: 5 });
    expect(trimSpan("a   b", { start: 1, end: 3 })).toBeNull();
    expect(trimSpan("abc", { start: 3, end: 1 })).toEqual({ start: 1, end: 3 });
  });
  it("两端落在单词中间时扩展到整个单词", () => {
    const text = "has drawn widespread attention from both";
    const pick = (from: string, to: string) => {
      const span = snapToWords(text, {
        start: text.indexOf(from),
        end: text.indexOf(to) + to.length,
      });
      return text.slice(span.start, span.end);
    };
    expect(pick("as drawn", "attention fro")).toBe("has drawn widespread attention from");
    expect(pick("drawn", "attention")).toBe("drawn widespread attention");
    expect(snapToWords("one's mind", { start: 2, end: 7 })).toEqual({ start: 0, end: 10 });
  });
  it("只能在一个句子内", () => {
    const sentences = [
      { start: 0, end: 10 },
      { start: 11, end: 20 },
    ];
    expect(sentenceContaining(sentences, { start: 2, end: 8 })).toBe(sentences[0]);
    expect(sentenceContaining(sentences, { start: 8, end: 12 })).toBeNull();
  });
  it("把页面选区换算成全文位置", () => {
    document.body.innerHTML = `<div id="c"><p><span data-offset="0">He has </span><mark data-offset="7">drawn</mark><span data-offset="12"> it.</span></p></div>`;
    const container = document.getElementById("c")!;
    const first = container.querySelector("span")!.firstChild!;
    const last = container.querySelectorAll("span")[1]!.firstChild!;
    const range = document.createRange();
    range.setStart(first, 3);
    range.setEnd(last, 3);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    expect(selectionSpan(container)).toEqual({ start: 3, end: 15 });
  });
});

import { describe, expect, it } from "vitest";
import { cleanText, normalizeArticleText } from "./clean";

/** 生成一段按固定宽度硬换行的文本 */
function hardWrap(text: string, width: number): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line.length > 0 && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line.length > 0 ? `${line} ${word}` : word;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines.join("\n");
}

const P1 =
  "The new policy has drawn widespread attention from both experts and the public. Critics argue that it was introduced in the wake of a crisis, at the expense of careful planning.";
const P2 =
  "Supporters, however, point out that the government had to make a decision quickly. They say the measure will pay off in the long run.";

describe("cleanText", () => {
  it("合并被硬换行断开的句子", () => {
    const { text } = cleanText(hardWrap(P1, 60));
    expect(text).toBe(P1);
  });

  it("空行分段，段内硬换行合并", () => {
    const { text } = cleanText(`${hardWrap(P1, 60)}\n\n${hardWrap(P2, 60)}`);
    expect(text).toBe(`${P1}\n\n${P2}`);
  });

  it("没有空行时，以句末标点结尾的短行作为段落末行", () => {
    const raw = [
      "The new policy has drawn widespread attention from both experts",
      "and the public, and critics argue that it was introduced in the",
      "wake of a crisis.",
      "Supporters, however, point out that the government had to make",
      "a decision quickly, and they say the measure will pay off in the",
      "long run.",
    ].join("\n");
    expect(cleanText(raw).text).toBe(
      [
        "The new policy has drawn widespread attention from both experts and the public, and critics argue that it was introduced in the wake of a crisis.",
        "Supporters, however, point out that the government had to make a decision quickly, and they say the measure will pay off in the long run.",
      ].join("\n\n"),
    );
  });

  it("没有标点的短行当作标题单独成段", () => {
    const raw = `A Short Heading\n${hardWrap(P1, 60)}`;
    expect(cleanText(raw).text).toBe(`A Short Heading\n\n${P1}`);
  });

  it("短行没有句末标点且下一行小写开头时仍然合并", () => {
    const raw = [
      "The committee, which met on Tuesday to review the proposal in",
      "detail and",
      "at length, decided to postpone the vote until the following week",
      "so that every member could read the report beforehand.",
    ].join("\n");
    expect(cleanText(raw).text).toBe(
      "The committee, which met on Tuesday to review the proposal in detail and at length, decided to postpone the vote until the following week so that every member could read the report beforehand.",
    );
  });

  it("修复跨行断词并记录位置", () => {
    const raw = [
      "The new policy has drawn wide-",
      "spread attention from experts and has been discussed in every",
      "newspaper across the country for weeks.",
    ].join("\n");
    const { text, joins } = cleanText(raw);
    expect(text).toContain("drawn widespread attention");
    expect(joins).toEqual([{ offset: text.indexOf("widespread"), word: "widespread" }]);
  });

  it("well-known 这类误合并会出现在记录中，供用户检查", () => {
    const raw = [
      "She is a well-",
      "known author whose books have been translated into more than",
      "twenty languages around the world.",
    ].join("\n");
    const { text, joins } = cleanText(raw);
    expect(text).toContain("a wellknown author");
    expect(joins.map((j) => j.word)).toEqual(["wellknown"]);
  });

  it("连字符后接大写时保留连字符", () => {
    const raw = [
      "The delegation met with several non-",
      "European partners during the summit that was held in the capital",
      "last month.",
    ].join("\n");
    const { text, joins } = cleanText(raw);
    expect(text).toContain("non-European partners");
    expect(joins).toEqual([]);
  });

  it("多段文本中断词位置按全文下标计算", () => {
    const second = [
      "Economists expect the reform to have far-",
      "reaching consequences for small businesses in every region of",
      "the country.",
    ].join("\n");
    const { text, joins } = cleanText(`${hardWrap(P1, 60)}\n\n${second}`);
    expect(joins).toHaveLength(1);
    const join = joins[0];
    expect(join?.word).toBe("farreaching");
    expect(text.slice(join?.offset, (join?.offset ?? 0) + 11)).toBe("farreaching");
  });

  it("去除多余空白和不可见字符", () => {
    const { text } = cleanText("  Heavy\u00A0 rain\t fell   all\u200B night.  ");
    expect(text).toBe("Heavy rain fell all night.");
  });

  it("每行都很长时，每个换行都是段落边界", () => {
    const long1 = `${P1} ${P2}`;
    const long2 = `${P2} ${P1}`;
    expect(cleanText(`${long1}\n${long2}`).text).toBe(`${long1}\n\n${long2}`);
  });

  it("paragraph 模式下每行一段，不修复断词", () => {
    const { text, joins } = cleanText("First line ends with wide-\nspread second.", "paragraph");
    expect(text).toBe("First line ends with wide-\n\nspread second.");
    expect(joins).toEqual([]);
  });

  it("join 模式下单个换行一律合并", () => {
    const { text } = cleanText("Title line\nmore text here.\n\nNext paragraph.", "join");
    expect(text).toBe("Title line more text here.\n\nNext paragraph.");
  });

  it("处理 Windows 换行并忽略首尾空行", () => {
    expect(cleanText("\r\n\r\nHello there.\r\n\r\n").text).toBe("Hello there.");
  });

  it("空文本", () => {
    expect(cleanText("   \n \n")).toEqual({ text: "", joins: [] });
  });
});

describe("normalizeArticleText", () => {
  it("空行分段、段内换行并为空格", () => {
    expect(normalizeArticleText("A  b\nc.\n \n\n D e.\n")).toBe("A b c.\n\nD e.");
  });
});

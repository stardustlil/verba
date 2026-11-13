import { describe, expect, it } from "vitest";
import { segmentSentences, splitParagraphs } from "./segment";

const texts = (text: string) => segmentSentences(text).map((s) => s.text);

describe("splitParagraphs", () => {
  it("按空行分段并记录下标", () => {
    const text = "First one.\n\nSecond one.\n\n\nThird.";
    const paragraphs = splitParagraphs(text);
    expect(paragraphs.map((p) => p.text)).toEqual(["First one.", "Second one.", "Third."]);
    for (const p of paragraphs) expect(text.slice(p.start, p.end)).toBe(p.text);
  });
});

describe("segmentSentences", () => {
  it("基本断句", () => {
    expect(texts("It rained all day. We stayed home! Did you? Yes.")).toEqual([
      "It rained all day.",
      "We stayed home!",
      "Did you?",
      "Yes.",
    ]);
  });

  it("编号连续，下标可还原原文", () => {
    const text = "One here. Two here.\n\nThree here. Four here.";
    const sentences = segmentSentences(text);
    expect(sentences.map((s) => s.idx)).toEqual([0, 1, 2, 3]);
    expect(sentences.map((s) => s.paragraphIdx)).toEqual([0, 0, 1, 1]);
    for (const s of sentences) expect(text.slice(s.start, s.end)).toBe(s.text);
  });

  it("称谓缩写不断句", () => {
    expect(texts("Mr. Smith met Dr. Jones and Prof. Lee. They talked.")).toEqual([
      "Mr. Smith met Dr. Jones and Prof. Lee.",
      "They talked.",
    ]);
  });

  it("U.S. 后面不是句首词时不断句", () => {
    expect(texts("The U.S. Senate passed the bill. It now goes to the House.")).toEqual([
      "The U.S. Senate passed the bill.",
      "It now goes to the House.",
    ]);
  });

  it("U.S. 在句末且后面是句首词时断句", () => {
    expect(texts("He moved to the U.S. The move changed his life.")).toEqual([
      "He moved to the U.S.",
      "The move changed his life.",
    ]);
  });

  it("e.g. 和 i.e. 不断句", () => {
    expect(
      texts("Use a fixed phrase, e.g. In the wake of, when you can. I.e. This works."),
    ).toEqual(["Use a fixed phrase, e.g. In the wake of, when you can.", "I.e. This works."]);
  });

  it("etc. 后接句首词时断句，否则不断", () => {
    expect(texts("They sell pens, paper, etc. The shop is small.")).toEqual([
      "They sell pens, paper, etc.",
      "The shop is small.",
    ]);
    expect(texts("Pens, paper, etc. Are sold here? No.")).toEqual([
      "Pens, paper, etc. Are sold here?",
      "No.",
    ]);
  });

  it("姓名首字母不断句", () => {
    expect(texts("The book was written by J. K. Rowling. It sold well.")).toEqual([
      "The book was written by J. K. Rowling.",
      "It sold well.",
    ]);
    expect(texts("George W. Bush spoke first. Others followed.")).toEqual([
      "George W. Bush spoke first.",
      "Others followed.",
    ]);
  });

  it("小数和网址里的句点不断句", () => {
    expect(texts("Prices rose 3.5 percent. See example.com for details.")).toEqual([
      "Prices rose 3.5 percent.",
      "See example.com for details.",
    ]);
  });

  it("编号、图表、页码缩写不断句", () => {
    expect(texts("See Fig. 3 and No. 5 on p. 12. Then continue.")).toEqual([
      "See Fig. 3 and No. 5 on p. 12.",
      "Then continue.",
    ]);
  });

  it("以数字结尾的句子正常断句", () => {
    expect(texts("It happened in 1999. Then everything changed.")).toEqual([
      "It happened in 1999.",
      "Then everything changed.",
    ]);
  });

  it("段首的列表序号不单独成句", () => {
    expect(texts("1. Make a decision. Stick to it.")).toEqual([
      "1. Make a decision.",
      "Stick to it.",
    ]);
  });

  it("引号内的句末标点", () => {
    expect(texts("He said, “Stop.” Then he left. “Why?” she asked.")).toEqual([
      "He said, “Stop.”",
      "Then he left.",
      "“Why?” she asked.",
    ]);
  });

  it("下一句以引号或括号开头", () => {
    expect(texts('It ended. "We won," he said. (Nobody agreed.) Fine.')).toEqual([
      "It ended.",
      '"We won," he said.',
      "(Nobody agreed.)",
      "Fine.",
    ]);
  });

  it("省略号后小写不断句，大写断句", () => {
    expect(texts("Well... maybe later. He paused... Then he spoke.")).toEqual([
      "Well... maybe later.",
      "He paused...",
      "Then he spoke.",
    ]);
  });

  it("连续的问号和感叹号", () => {
    expect(texts("Really?! Yes.")).toEqual(["Really?!", "Yes."]);
  });

  it("a.m. 和月份缩写", () => {
    expect(
      texts(
        "The meeting starts at 9 a.m. on Jan. 5 in Boston. It ends at 5 p.m. The room is small.",
      ),
    ).toEqual([
      "The meeting starts at 9 a.m. on Jan. 5 in Boston.",
      "It ends at 5 p.m.",
      "The room is small.",
    ]);
  });

  it("没有句末标点的标题单独成句", () => {
    expect(texts("A Short Heading\n\nThe body starts here. It goes on.")).toEqual([
      "A Short Heading",
      "The body starts here.",
      "It goes on.",
    ]);
  });

  it("空文本", () => {
    expect(segmentSentences("")).toEqual([]);
  });
});

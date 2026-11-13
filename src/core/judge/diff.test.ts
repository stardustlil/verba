import { describe, expect, it } from "vitest";
import { type WordMark, diffAnswer } from "./diff";

const kinds = (marks: WordMark[]) => marks.map((m) => m.kind);

describe("diffAnswer", () => {
  it("全对时每个词都是 ok，保留用户的大小写", () => {
    expect(diffAnswer("Heavy rain", "heavy rain")).toEqual([
      { kind: "ok", text: "Heavy" },
      { kind: "ok", text: "rain" },
    ]);
  });

  it("拼写错误：标出错词和具体字母", () => {
    const marks = diffAnswer("drawn widesprad attention", "drawn widespread attention");
    expect(kinds(marks)).toEqual(["ok", "wrong", "ok"]);
    const wrong = marks[1];
    if (wrong?.kind !== "wrong") throw new Error("应为 wrong");
    expect(wrong.text).toBe("widesprad");
    expect(wrong.expected).toBe("widespread");
    // 漏掉了 e
    expect(wrong.chars.filter((c) => c.kind !== "ok")).toEqual([{ ch: "e", kind: "missing" }]);
    expect(
      wrong.chars
        .filter((c) => c.kind !== "missing")
        .map((c) => c.ch)
        .join(""),
    ).toBe("widesprad");
  });

  it("写错字母和多写字母", () => {
    const marks = diffAnswer("heavy raim", "heavy rain");
    const wrong = marks[1];
    if (wrong?.kind !== "wrong") throw new Error("应为 wrong");
    expect(wrong.chars).toEqual([
      { ch: "r", kind: "ok" },
      { ch: "a", kind: "ok" },
      { ch: "i", kind: "ok" },
      { ch: "m", kind: "wrong" },
    ]);

    const extra = diffAnswer("heavvy rain", "heavy rain")[0];
    if (extra?.kind !== "wrong") throw new Error("应为 wrong");
    expect(extra.chars.filter((c) => c.kind === "wrong")).toEqual([{ ch: "v", kind: "wrong" }]);
  });

  it("少词", () => {
    expect(diffAnswer("in wake of", "in the wake of")).toEqual([
      { kind: "ok", text: "in" },
      { kind: "missing", expected: "the" },
      { kind: "ok", text: "wake" },
      { kind: "ok", text: "of" },
    ]);
  });

  it("多词", () => {
    expect(kinds(diffAnswer("in the very wake of", "in the wake of"))).toEqual([
      "ok",
      "ok",
      "extra",
      "ok",
      "ok",
    ]);
  });

  it("换词", () => {
    const marks = diffAnswer("strong rain", "heavy rain");
    expect(kinds(marks)).toEqual(["wrong", "ok"]);
  });

  it("词序错误显示为一多一少", () => {
    const marks = diffAnswer("attention draw", "draw attention");
    expect(marks.filter((m) => m.kind === "ok")).toHaveLength(1);
    expect(kinds(marks).sort()).toEqual(["extra", "missing", "ok"]);
  });

  it("缩写与全写的差异不标红", () => {
    const marks = diffAnswer("do not make sence", "don't make sense");
    expect(kinds(marks)).toEqual(["ok", "ok", "ok", "wrong"]);
  });

  it("歧义缩写选最接近的展开", () => {
    const marks = diffAnswer("it has been a whlie", "it's been a while");
    expect(kinds(marks)).toEqual(["ok", "ok", "ok", "ok", "wrong"]);
  });

  it("英美拼写差异不标红", () => {
    expect(kinds(diffAnswer("a splash of colour here", "a splash of color"))).toEqual([
      "ok",
      "ok",
      "ok",
      "ok",
      "extra",
    ]);
  });

  it("纯中文默写中的代词占位不标红", () => {
    expect(kinds(diffAnswer("make up his mnd", "make up one's mind", true))).toEqual([
      "ok",
      "ok",
      "ok",
      "wrong",
    ]);
    expect(kinds(diffAnswer("make up his mind", "make up one's mind", false))).toEqual([
      "ok",
      "ok",
      "wrong",
      "ok",
    ]);
  });

  it("空输入：全部缺失", () => {
    expect(diffAnswer("", "heavy rain")).toEqual([
      { kind: "missing", expected: "heavy" },
      { kind: "missing", expected: "rain" },
    ]);
  });
});

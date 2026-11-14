import { describe, expect, it } from "vitest";
import { expandContraction } from "./contractions";
import { clozeTargets, isCorrect, recallTargets } from "./judge";
import { countWords, displayTokens, lemmaKey } from "./normalize";
import { canonicalSpelling } from "./spelling";

const cloze = (input: string, surface: string) => isCorrect(input, clozeTargets(surface));
const recall = (input: string, lemma: string, alts: string[] = []) =>
  isCorrect(input, recallTargets(lemma, alts));

describe("视为相同，不算错误", () => {
  it("大小写差异", () => {
    expect(cloze("Drawn Widespread ATTENTION", "drawn widespread attention")).toBe(true);
    expect(cloze("in the wake of", "In the wake of")).toBe(true);
  });

  it("首尾空格和连续多个空格", () => {
    expect(cloze("  drawn   widespread attention ", "drawn widespread attention")).toBe(true);
  });

  it("句末标点", () => {
    expect(cloze("drawn widespread attention.", "drawn widespread attention")).toBe(true);
    expect(cloze("make a decision", "make a decision!")).toBe(true);
    expect(cloze("make a decision?!", "make a decision")).toBe(true);
  });

  it("直引号与弯引号", () => {
    expect(recall("make up one’s mind", "make up one's mind")).toBe(true);
    expect(cloze("the company's future", "the company’s future")).toBe(true);
  });

  it("缩写与全写", () => {
    expect(cloze("do not make sense", "don't make sense")).toBe(true);
    expect(cloze("don’t make sense", "do not make sense")).toBe(true);
    expect(cloze("it is worth noting", "it's worth noting")).toBe(true);
    expect(cloze("can not help but", "can't help but")).toBe(true);
    expect(cloze("cannot help but", "can't help but")).toBe(true);
    expect(cloze("will not budge", "won't budge")).toBe(true);
  });

  it("有歧义的缩写，任一种展开与答案一致即算对", () => {
    expect(cloze("it has been a while", "it's been a while")).toBe(true);
    expect(cloze("it is been a while", "it's been a while")).toBe(true);
    expect(cloze("it's a pity", "it is a pity")).toBe(true);
    expect(cloze("it's a pity", "it has a pity")).toBe(true);
    expect(cloze("he would rather", "he'd rather")).toBe(true);
    expect(cloze("he had better", "he'd better")).toBe(true);
    expect(cloze("he'd better", "he had better")).toBe(true);
  });

  it("所有格不当作缩写展开", () => {
    expect(expandContraction("john's")).toBeNull();
    expect(expandContraction("one's")).toBeNull();
    expect(cloze("John is car", "John's car")).toBe(false);
  });

  it("英式与美式拼写", () => {
    expect(cloze("a splash of colour", "a splash of color")).toBe(true);
    expect(cloze("organize a meeting", "organise a meeting")).toBe(true);
    expect(cloze("the organisation's centre", "the organization's center")).toBe(true);
    expect(canonicalSpelling("travelling")).toBe("traveling");
    expect(canonicalSpelling("constructor")).toBe("constructor");
  });

  it("连字符与空格", () => {
    expect(cloze("well known", "well-known")).toBe(true);
    expect(cloze("a well-known fact", "a well known fact")).toBe(true);
    expect(cloze("wellknown", "well-known")).toBe(false);
  });

  it("句中逗号", () => {
    expect(cloze("first and foremost", "first, and foremost")).toBe(true);
    expect(cloze("by and large, it works", "by and large it works")).toBe(true);
  });

  it("纯中文默写中 one's 可写作任一物主代词", () => {
    for (const p of ["my", "your", "his", "her", "its", "our", "their", "one's"]) {
      expect(recall(`make up ${p} mind`, "make up one's mind")).toBe(true);
    }
    expect(recall("make up the mind", "make up one's mind")).toBe(false);
  });

  it("纯中文默写中 oneself 可写作任一反身代词", () => {
    for (const p of ["myself", "yourself", "himself", "herself", "themselves", "oneself"]) {
      expect(recall(`pride ${p} on`, "pride oneself on")).toBe(true);
    }
    expect(recall("pride him on", "pride oneself on")).toBe(false);
  });

  it("纯中文默写中 someone 可写作任一宾格代词或 somebody / sb", () => {
    for (const p of ["me", "him", "her", "them", "us", "you", "someone", "somebody", "sb"]) {
      expect(recall(`talk ${p} into`, "talk someone into")).toBe(true);
    }
    expect(recall("dawn on me", "dawn on someone")).toBe(true);
    expect(recall("talk sb. into", "talk someone into")).toBe(true);
    expect(recall("talk into", "talk someone into")).toBe(false);
    expect(recall("talk his into", "talk someone into")).toBe(false);
  });

  it("语境填空不做代词替换，必须与原文形式一致", () => {
    expect(cloze("made up their mind", "made up his mind")).toBe(false);
    expect(cloze("made up his mind", "made up his mind")).toBe(true);
    expect(cloze("talked him into", "talked me into")).toBe(false);
  });

  it("与任一备选答案一致", () => {
    expect(recall("attract attention", "draw attention")).toBe(false);
    expect(recall("attract attention", "draw attention", ["attract attention"])).toBe(true);
    expect(recall("Attract  attention.", "draw attention", ["attract attention"])).toBe(true);
  });
});

describe("视为错误", () => {
  it("拼写错误，即使只差一个字母", () => {
    expect(cloze("drawn widesprad attention", "drawn widespread attention")).toBe(false);
    expect(cloze("heavy rian", "heavy rain")).toBe(false);
  });

  it("少词、多词、换词", () => {
    expect(cloze("in wake of", "in the wake of")).toBe(false);
    expect(cloze("in the very wake of", "in the wake of")).toBe(false);
    expect(cloze("strong rain", "heavy rain")).toBe(false);
  });

  it("词序错误", () => {
    expect(cloze("attention draw", "draw attention")).toBe(false);
  });

  it("语境填空必须写原文形式，写原形不算对", () => {
    expect(cloze("draw widespread attention", "drawn widespread attention")).toBe(false);
  });

  it("空输入", () => {
    expect(cloze("", "heavy rain")).toBe(false);
    expect(cloze("  . ", "heavy rain")).toBe(false);
  });
});

describe("normalize", () => {
  it("displayTokens：去掉逗号和句末标点，连字符当作空格，保留大小写", () => {
    expect(displayTokens("  Well-known,  “Facts”. ")).toEqual(["Well", "known", '"Facts"']);
  });

  it("countWords：连字符连接的算一个词", () => {
    expect(countWords("a well-known fact")).toBe(3);
    expect(countWords("make up one's mind")).toBe(4);
    expect(countWords("  ")).toBe(0);
  });

  it("lemmaKey 忽略大小写、引号写法和多余空格", () => {
    expect(lemmaKey(" Make  up one’s Mind ")).toBe("make up one's mind");
  });
});

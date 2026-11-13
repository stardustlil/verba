/**
 * 判对错（需求 5.4）。全部是确定的规则：
 * 把用户输入和答案各自展开成若干“等价写法”，只要有一对逐词相同即为正确。
 */
import { expandContraction } from "./contractions";
import { displayTokens } from "./normalize";
import { slotAccepts } from "./pronouns";
import { canonicalSpelling } from "./spelling";

export interface Token {
  /** 用于比较：小写、规范拼写 */
  key: string;
  /** 用于展示：尽量保留原样 */
  display: string;
}

export interface JudgeTarget {
  text: string;
  /** 是否把 one's / oneself 当作占位（只在纯中文默写中开启） */
  slots: boolean;
}

/** 歧义缩写会让写法成倍增加，设个上限 */
const MAX_VARIANTS = 32;

/** 一段文字的全部等价写法。缩写展开为全写，歧义缩写产生多种写法。 */
export function variants(text: string): Token[][] {
  let results: Token[][] = [[]];
  for (const display of displayTokens(text)) {
    const lower = display.toLowerCase();
    const expansions = expandContraction(lower);
    const options: Token[][] = expansions
      ? expansions.map((words) => words.map((w) => ({ key: canonicalSpelling(w), display: w })))
      : [[{ key: canonicalSpelling(lower), display }]];
    const next: Token[][] = [];
    for (const prefix of results) {
      for (const option of options) {
        if (next.length >= MAX_VARIANTS) break;
        next.push([...prefix, ...option]);
      }
    }
    results = next;
  }
  return results;
}

export function tokenMatches(expected: Token, actual: Token, slots: boolean): boolean {
  return expected.key === actual.key || (slots && slotAccepts(expected.key, actual.key));
}

function sequenceMatches(expected: Token[], actual: Token[], slots: boolean): boolean {
  return (
    expected.length === actual.length &&
    expected.every((token, i) => {
      const other = actual[i];
      return other !== undefined && tokenMatches(token, other, slots);
    })
  );
}

export function isCorrect(input: string, targets: JudgeTarget[]): boolean {
  const inputVariants = variants(input);
  if (inputVariants.every((v) => v.length === 0)) return false;
  return targets.some((target) => {
    const targetVariants = variants(target.text);
    return targetVariants.some((expected) =>
      inputVariants.some((actual) => sequenceMatches(expected, actual, target.slots)),
    );
  });
}

/** 语境填空：只接受原文形式 */
export function clozeTargets(surface: string): JudgeTarget[] {
  return [{ text: surface, slots: false }];
}

/** 纯中文默写：接受原形或任一备选答案 */
export function recallTargets(lemma: string, altAnswers: string[] = []): JudgeTarget[] {
  return [lemma, ...altAnswers].map((text) => ({ text, slots: true }));
}

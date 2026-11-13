import { describe, expect, it } from "vitest";
import { locateSurface } from "../../core/extract/validate";
import { countWords, lemmaKey } from "../../core/judge/normalize";
import { BUILTIN_BOOKS } from "./index";

const CJK = /[一-鿿]/;
/** 原形里不能出现具体的人称代词，应写作 one's / oneself / someone（需求 3.1.1） */
const PRONOUN =
  /\b(my|your|his|her|its|our|their|myself|yourself|himself|herself|itself|ourselves|themselves|him|them|me|us)\b/i;

describe("内置词书", () => {
  it("三本书，每本至少 200 条", () => {
    expect(BUILTIN_BOOKS).toHaveLength(3);
    for (const book of BUILTIN_BOOKS) {
      expect(book.entries.length, book.id).toBeGreaterThanOrEqual(200);
      expect(book.title).toMatch(CJK);
      expect(book.version).toBeGreaterThanOrEqual(1);
    }
  });

  it("原形在所有书中不重复", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const book of BUILTIN_BOOKS) {
      for (const entry of book.entries) {
        const key = lemmaKey(entry.lemma);
        if (seen.has(key)) duplicates.push(`${entry.lemma}（${seen.get(key)} / ${book.id}）`);
        seen.set(key, book.id);
      }
    }
    expect(duplicates).toEqual([]);
  });

  for (const book of BUILTIN_BOOKS) {
    it(`《${book.title}》每个条目都合格`, () => {
      const problems: string[] = [];
      for (const e of book.entries) {
        const where = `${book.id}: ${e.lemma}`;
        if (!e.example.includes(e.surface))
          problems.push(`${where} 例句中没有原文形式“${e.surface}”`);
        else if (!locateSurface(e.example, e.surface))
          problems.push(`${where} 原文形式不是完整的词`);
        for (const [name, text] of [
          ["原形", e.lemma],
          ["原文形式", e.surface],
        ] as const) {
          const n = countWords(text);
          if (n < 2 || n > 8) problems.push(`${where} ${name}有 ${n} 个词`);
        }
        if (e.lemma !== e.lemma.trim() || /\s{2}/.test(e.lemma))
          problems.push(`${where} 原形有多余空格`);
        if (/[A-Z]/.test(e.lemma.replace(/\bI\b/g, ""))) problems.push(`${where} 原形应为小写`);
        if (PRONOUN.test(e.lemma)) problems.push(`${where} 原形含具体人称代词`);
        if (!CJK.test(e.meaning)) problems.push(`${where} 释义不是中文`);
        if (!CJK.test(e.translation)) problems.push(`${where} 缺少中文翻译`);
        if (!/[.!?]["”’]?$/.test(e.example)) problems.push(`${where} 例句没有句末标点`);
      }
      expect(problems).toEqual([]);
    });
  }
});

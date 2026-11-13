/**
 * 原形中的占位写法（需求 3.1.1 与 5.4，someone 为 2026-11-12 与用户确认后新增）：
 * - one's 可写作任一物主代词
 * - oneself 可写作任一反身代词
 * - someone 可写作任一宾格人称代词，或 somebody / sb
 */

export const POSSESSIVE_SLOT = "one's";
export const REFLEXIVE_SLOT = "oneself";
export const PERSON_SLOT = "someone";

const POSSESSIVES = new Set(["my", "your", "his", "her", "its", "our", "their", POSSESSIVE_SLOT]);
const REFLEXIVES = new Set([
  "myself",
  "yourself",
  "yourselves",
  "himself",
  "herself",
  "itself",
  "ourselves",
  "themselves",
  "themself",
  REFLEXIVE_SLOT,
]);
const PERSONS = new Set([
  "me",
  "you",
  "him",
  "her",
  "it",
  "us",
  "them",
  "somebody",
  "sb",
  "sb.",
  "one",
  PERSON_SLOT,
]);

/** 答案里的词 expected 是否接受用户写的 actual（均为小写、已归一化） */
export function slotAccepts(expected: string, actual: string): boolean {
  if (expected === POSSESSIVE_SLOT) return POSSESSIVES.has(actual);
  if (expected === REFLEXIVE_SLOT) return REFLEXIVES.has(actual);
  if (expected === PERSON_SLOT) return PERSONS.has(actual);
  return false;
}

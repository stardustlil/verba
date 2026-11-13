/**
 * 跟写：照着目标文字逐个字母输入。忽略大小写，直引号与弯引号视为相同。
 * 打错的字母立刻标红，必须删掉改对才能继续（界面据此拒绝错字母之后的输入）。
 */
import { straightenQuotes } from "./normalize";

export type CharState = "done" | "wrong" | "todo";

export interface CopyProgress {
  /** 目标文字每个字符的状态 */
  states: CharState[];
  /** 从开头起连续输对的字符数 */
  matched: number;
  /** 第一个输错的位置；没有输错为 null */
  wrongAt: number | null;
  /** 是否已完整、正确地输完 */
  complete: boolean;
}

function same(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return straightenQuotes(a).toLowerCase() === straightenQuotes(b).toLowerCase();
}

export function copyProgress(target: string, typed: string): CopyProgress {
  const goal = [...target];
  const input = [...typed];
  let matched = 0;
  while (matched < input.length && matched < goal.length && same(goal[matched], input[matched]))
    matched++;
  const wrongAt = matched < input.length ? matched : null;
  const states: CharState[] = goal.map((_, i) =>
    i < matched ? "done" : i === wrongAt ? "wrong" : "todo",
  );
  return {
    states,
    matched,
    wrongAt,
    complete: wrongAt === null && matched === goal.length,
  };
}

/**
 * 跟写时实际接受的输入：输错的字母之后不再接受新的字母（必须先删掉改对），
 * 也不接受超出目标长度的部分。粘贴一整段时同样按此截断。
 */
export function clampCopyInput(target: string, next: string): string {
  const chars = [...next];
  const { wrongAt } = copyProgress(target, next);
  const limit = Math.min([...target].length, wrongAt === null ? chars.length : wrongAt + 1);
  return chars.slice(0, limit).join("");
}

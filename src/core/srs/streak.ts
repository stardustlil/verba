/**
 * 连续学习天数（需求第 6 节）：
 * 当天完成“当天开始时已到期的全部复习”即计为一天，不要求完成新句块；
 * 当天开始时没有到期复习的，当天有答题才算。
 */
import { addDays } from "./day";

export interface DayProgress {
  /** 当天开始时已到期、且目前仍存在的句块 */
  dueAtStart: string[];
  /** 当天已有计入调度的答题的句块 */
  answered: Set<string>;
  /** 当天的答题总数（含重出） */
  answerCount: number;
}

export function isDayComplete(progress: DayProgress): boolean {
  if (progress.answerCount === 0) return false;
  return progress.dueAtStart.every((id) => progress.answered.has(id));
}

/**
 * 截至今天的连续天数。今天还没完成时不算中断，从昨天往前数。
 */
export function computeStreak(completedDays: Iterable<string>, today: string): number {
  const completed = new Set(completedDays);
  let day = completed.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (completed.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

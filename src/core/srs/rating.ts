/** 自动评级（需求 5.5）：用户不需要自评 */

export type Rating = "good" | "hard" | "again";

export const DEFAULT_SLOW_MS = 30_000;

export interface AnswerOutcome {
  correct: boolean;
  viewedAnswer: boolean;
  /** 从按下第一个键到提交的用时，不含窗口失焦的时间 */
  durationMs: number;
}

export function rate(outcome: AnswerOutcome, slowMs: number = DEFAULT_SLOW_MS): Rating {
  if (outcome.viewedAnswer || !outcome.correct) return "again";
  return outcome.durationMs > slowMs ? "hard" : "good";
}

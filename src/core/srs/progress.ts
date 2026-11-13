/**
 * 一次计入调度的答题对句块学习进度的影响（需求 5.1、5.6）。
 * 纯函数：给定答题前的进度与评级，算出答题后的进度。
 * “我写的也对”改判时，从答题前的快照重新按“好”计算一次即可。
 */
import type { Rating } from "./rating";
import { schedule } from "./scheduler";
import { type QuestionMode, type Stage, afterCountedAnswer } from "./stage";

export interface ChunkProgress {
  stage: Stage;
  clozeStreak: number;
  /** 例句轮换游标：语境填空用第 cursor % 例句数 个例句 */
  exampleCursor: number;
  /** ts-fsrs 卡片的 JSON；null 表示还没有评过级 */
  fsrsCard: string | null;
  due: number | null;
  scheduledDays: number;
}

export function applyCountedAnswer(
  before: ChunkProgress,
  mode: QuestionMode,
  rating: Rating,
  now: number,
): ChunkProgress {
  const scheduled = schedule(before.fsrsCard, rating, now);
  const stage = afterCountedAnswer(
    { stage: before.stage, clozeStreak: before.clozeStreak },
    mode,
    rating,
  );
  return {
    stage: stage.stage,
    clozeStreak: stage.clozeStreak,
    // 语境填空答过一次（计入调度的那次）后换下一个例句，本轮重出仍用同一个
    exampleCursor: mode === "cloze" ? before.exampleCursor + 1 : before.exampleCursor,
    fsrsCard: scheduled.card,
    due: scheduled.due,
    scheduledDays: scheduled.scheduledDays,
  };
}

/** 一轮练习中，一个例句的选择 */
export function pickExample<T>(examples: readonly T[], cursor: number): T | undefined {
  if (examples.length === 0) return undefined;
  return examples[((cursor % examples.length) + examples.length) % examples.length];
}

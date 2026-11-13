/**
 * 题型阶段与句块状态（需求第 4 节、5.1）。
 * 只有计入调度的答题（每天第一次）才会改变阶段和连续答对次数。
 */
import type { Rating } from "./rating";
import { MASTERED_INTERVAL_DAYS } from "./scheduler";

/** new 尚未认识；cloze 语境填空；recall 纯中文默写 */
export type Stage = "new" | "cloze" | "recall";
export type QuestionMode = "cloze" | "recall";
export type ChunkStatus = "new" | "learning" | "mastered";

/** 语境填空连续答对这么多次后升级为纯中文默写 */
export const CLOZE_STREAK_TO_PROMOTE = 2;

export interface StageState {
  stage: Stage;
  clozeStreak: number;
}

/** 认识之后进入语境填空 */
export function afterIntro(): StageState {
  return { stage: "cloze", clozeStreak: 0 };
}

export function afterCountedAnswer(
  state: StageState,
  mode: QuestionMode,
  rating: Rating,
): StageState {
  const correct = rating !== "again";
  if (mode === "recall") {
    // 纯中文默写答错时降回语境填空，重新计算连续答对次数
    return correct
      ? { stage: "recall", clozeStreak: state.clozeStreak }
      : { stage: "cloze", clozeStreak: 0 };
  }
  if (!correct) return { stage: "cloze", clozeStreak: 0 };
  const streak = state.clozeStreak + 1;
  return streak >= CLOZE_STREAK_TO_PROMOTE
    ? { stage: "recall", clozeStreak: streak }
    : { stage: "cloze", clozeStreak: streak };
}

/** 当前阶段出什么题。尚未认识的句块没有题型。 */
export function questionMode(stage: Stage): QuestionMode | null {
  return stage === "new" ? null : stage;
}

export function chunkStatus(stage: Stage, scheduledDays: number): ChunkStatus {
  if (stage === "new") return "new";
  return scheduledDays >= MASTERED_INTERVAL_DAYS ? "mastered" : "learning";
}

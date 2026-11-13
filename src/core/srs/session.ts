/**
 * 一轮练习的出题队列。纯数据操作，不涉及界面和数据库。
 *
 * 一轮按阶段进行：先做全部到期复习，再让这一轮的新句块依次过三遍——
 * 跟写（照着打一遍）→ 语境填空 → 纯中文默写。
 * 答错的题在本阶段稍后重出，直到答对；重出不会越过阶段的边界。
 */

/** review 复习；copy 跟写；cloze 语境填空；recall 纯中文默写 */
export type Phase = "review" | "copy" | "cloze" | "recall";

export const PHASES: readonly Phase[] = ["review", "copy", "cloze", "recall"];

export const PHASE_LABEL: Record<Phase, string> = {
  review: "复习",
  copy: "跟写",
  cloze: "填空",
  recall: "默写",
};

export interface QueueItem {
  chunkId: string;
  phase: Phase;
  /** 是否为答错后的重出 */
  retry?: boolean;
}

/** 答错之后，隔这么多题再出 */
export const REPEAT_GAP = 4;

const order = (phase: Phase) => PHASES.indexOf(phase);

/** dueIds、newIds 均已按出场顺序排好 */
export function buildRound(dueIds: readonly string[], newIds: readonly string[]): QueueItem[] {
  return [
    ...dueIds.map((chunkId) => ({ chunkId, phase: "review" as const })),
    ...newIds.map((chunkId) => ({ chunkId, phase: "copy" as const })),
    ...newIds.map((chunkId) => ({ chunkId, phase: "cloze" as const })),
    ...newIds.map((chunkId) => ({ chunkId, phase: "recall" as const })),
  ];
}

/** 当前题（队首）答完：答对则移出队列；答错则在本阶段稍后再出 */
export function afterAnswer(queue: readonly QueueItem[], correct: boolean): QueueItem[] {
  const [head, ...rest] = queue;
  if (!head) return [...queue];
  if (correct) return rest;
  const phaseEnd = rest.findIndex((item) => order(item.phase) > order(head.phase));
  const limit = phaseEnd < 0 ? rest.length : phaseEnd;
  const at = Math.min(REPEAT_GAP, limit);
  return [...rest.slice(0, at), { ...head, retry: true }, ...rest.slice(at)];
}

/** 句块被删除：去掉它在各阶段的所有题 */
export function withoutChunk(queue: readonly QueueItem[], chunkId: string): QueueItem[] {
  return queue.filter((item) => item.chunkId !== chunkId);
}

export interface PhaseProgress {
  phase: Phase;
  total: number;
  done: number;
}

/**
 * 各阶段的进度：total 为这一轮开始时该阶段的题数，done 为已经做完的（重出不重复计数）。
 * 删除的句块从 total 中扣掉。
 */
export function phaseProgress(
  initial: readonly QueueItem[],
  queue: readonly QueueItem[],
  deleted: ReadonlySet<string> = new Set(),
): PhaseProgress[] {
  return PHASES.map((phase) => {
    const planned = new Set(
      initial.filter((i) => i.phase === phase && !deleted.has(i.chunkId)).map((i) => i.chunkId),
    );
    const pending = new Set(
      queue.filter((i) => i.phase === phase && planned.has(i.chunkId)).map((i) => i.chunkId),
    );
    return { phase, total: planned.size, done: planned.size - pending.size };
  }).filter((p) => p.total > 0);
}

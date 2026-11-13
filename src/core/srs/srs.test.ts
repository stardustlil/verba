import { describe, expect, it } from "vitest";
import { addDays, dayStart, isDueOn, studyDay } from "./day";
import { rate } from "./rating";
import { MASTERED_INTERVAL_DAYS, schedule } from "./scheduler";
import {
  REPEAT_GAP,
  type QueueItem,
  afterAnswer,
  buildRound,
  phaseProgress,
  withoutChunk,
} from "./session";
import { afterCountedAnswer, afterIntro, chunkStatus, questionMode } from "./stage";
import { computeStreak, isDayComplete } from "./streak";

const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();

describe("学习日（凌晨 4 点分界）", () => {
  it("凌晨 4 点前算前一天", () => {
    expect(studyDay(at(2026, 11, 12, 3, 59))).toBe("2026-11-11");
    expect(studyDay(at(2026, 11, 12, 4, 0))).toBe("2026-11-12");
    expect(studyDay(at(2026, 11, 12, 23, 59))).toBe("2026-11-12");
  });

  it("跨月、跨年", () => {
    expect(studyDay(at(2026, 12, 1, 2))).toBe("2026-11-30");
    expect(studyDay(at(2027, 1, 1, 1))).toBe("2026-12-31");
  });

  it("dayStart 是当天凌晨 4 点", () => {
    expect(dayStart("2026-11-12")).toBe(at(2026, 11, 12, 4));
    expect(studyDay(dayStart("2026-11-12"))).toBe("2026-11-12");
    expect(studyDay(dayStart("2026-11-12") - 1)).toBe("2026-11-11");
  });

  it("addDays", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("到期按天计：当天晚些时候才到点的也算当天到期", () => {
    const due = at(2026, 11, 13, 23);
    expect(isDueOn(due, "2026-11-12")).toBe(false);
    expect(isDueOn(due, "2026-11-13")).toBe(true);
    expect(isDueOn(due, "2026-11-20")).toBe(true);
  });
});

describe("自动评级", () => {
  it("写对且不超过 30 秒为“好”", () => {
    expect(rate({ correct: true, viewedAnswer: false, durationMs: 30_000 })).toBe("good");
  });
  it("写对但超过 30 秒为“一般”", () => {
    expect(rate({ correct: true, viewedAnswer: false, durationMs: 30_001 })).toBe("hard");
  });
  it("写错或查看了答案为“忘了”", () => {
    expect(rate({ correct: false, viewedAnswer: false, durationMs: 1000 })).toBe("again");
    expect(rate({ correct: true, viewedAnswer: true, durationMs: 1000 })).toBe("again");
  });
  it("“写得慢”的时长可配置", () => {
    expect(rate({ correct: true, viewedAnswer: false, durationMs: 15_000 }, 10_000)).toBe("hard");
  });
});

describe("FSRS 调度", () => {
  it("第一次评级后间隔至少 1 天", () => {
    const now = at(2026, 11, 12);
    for (const rating of ["good", "hard", "again"] as const) {
      const result = schedule(null, rating, now);
      expect(result.scheduledDays).toBeGreaterThanOrEqual(1);
      expect(result.due).toBeGreaterThanOrEqual(now + 24 * 3600 * 1000);
    }
  });

  it("首次评级：好 的间隔不短于 一般，一般 不短于 忘了", () => {
    const now = at(2026, 11, 12);
    const good = schedule(null, "good", now).scheduledDays;
    const hard = schedule(null, "hard", now).scheduledDays;
    const again = schedule(null, "again", now).scheduledDays;
    expect(good).toBeGreaterThanOrEqual(hard);
    expect(hard).toBeGreaterThanOrEqual(again);
  });

  it("连续答对间隔递增，最终达到已掌握的间隔", () => {
    let now = at(2026, 11, 12);
    let card: string | null = null;
    const intervals: number[] = [];
    for (let i = 0; i < 6; i++) {
      const result = schedule(card, "good", now);
      intervals.push(result.scheduledDays);
      card = result.card;
      now = result.due;
    }
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]).toBeGreaterThan(intervals[i - 1] ?? 0);
    }
    expect(intervals.at(-1)).toBeGreaterThanOrEqual(MASTERED_INTERVAL_DAYS);
  });

  it("答错后间隔缩短到已掌握的阈值以下", () => {
    let now = at(2026, 11, 12);
    let card: string | null = null;
    let result = schedule(card, "good", now);
    while (result.scheduledDays < MASTERED_INTERVAL_DAYS) {
      card = result.card;
      now = result.due;
      result = schedule(card, "good", now);
    }
    const lapsed = schedule(result.card, "again", result.due);
    expect(lapsed.scheduledDays).toBeLessThan(MASTERED_INTERVAL_DAYS);
    expect(lapsed.scheduledDays).toBeGreaterThanOrEqual(1);
  });

  it("卡片可以序列化后原样传回", () => {
    const first = schedule(null, "good", at(2026, 11, 12));
    const viaJson = schedule(JSON.parse(JSON.stringify(first.card)) as string, "good", first.due);
    expect(viaJson.scheduledDays).toBeGreaterThan(first.scheduledDays);
  });
});

describe("题型升降级", () => {
  it("认识之后进入语境填空", () => {
    expect(afterIntro()).toEqual({ stage: "cloze", clozeStreak: 0 });
    expect(questionMode("new")).toBeNull();
    expect(questionMode("cloze")).toBe("cloze");
  });

  it("语境填空连续答对 2 次（好或一般）后升级为纯中文默写", () => {
    let state = afterIntro();
    state = afterCountedAnswer(state, "cloze", "good");
    expect(state).toEqual({ stage: "cloze", clozeStreak: 1 });
    state = afterCountedAnswer(state, "cloze", "hard");
    expect(state.stage).toBe("recall");
  });

  it("语境填空答错后连续次数清零", () => {
    let state = afterCountedAnswer(afterIntro(), "cloze", "good");
    state = afterCountedAnswer(state, "cloze", "again");
    expect(state).toEqual({ stage: "cloze", clozeStreak: 0 });
    state = afterCountedAnswer(state, "cloze", "good");
    expect(state.stage).toBe("cloze");
    state = afterCountedAnswer(state, "cloze", "good");
    expect(state.stage).toBe("recall");
  });

  it("纯中文默写答对保持，答错降回语境填空并重新计数", () => {
    const recall = { stage: "recall" as const, clozeStreak: 2 };
    expect(afterCountedAnswer(recall, "recall", "good").stage).toBe("recall");
    expect(afterCountedAnswer(recall, "recall", "hard").stage).toBe("recall");
    expect(afterCountedAnswer(recall, "recall", "again")).toEqual({
      stage: "cloze",
      clozeStreak: 0,
    });
  });

  it("句块状态由阶段和间隔推导", () => {
    expect(chunkStatus("new", 0)).toBe("new");
    expect(chunkStatus("cloze", 0)).toBe("learning");
    expect(chunkStatus("recall", 20)).toBe("learning");
    expect(chunkStatus("recall", 21)).toBe("mastered");
  });
});

describe("出题队列", () => {
  const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  const shape = (queue: QueueItem[]) =>
    queue.map((q) => `${q.phase[0]}${q.chunkId}${q.retry ? "!" : ""}`).join(" ");

  it("一轮：先复习，再让新句块依次过跟写、填空、默写", () => {
    expect(shape(buildRound(["d0", "d1"], ["n0", "n1"]))).toBe("rd0 rd1 cn0 cn1 cn0 cn1 rn0 rn1");
    const round = buildRound(["d0"], ["n0", "n1"]);
    expect(round.map((q) => q.phase)).toEqual([
      "review",
      "copy",
      "copy",
      "cloze",
      "cloze",
      "recall",
      "recall",
    ]);
    expect(buildRound([], [])).toEqual([]);
  });

  it("答对移出队列", () => {
    const queue = buildRound(ids("d", 3), []);
    expect(afterAnswer(queue, true).map((q) => q.chunkId)).toEqual(["d1", "d2"]);
  });

  it("答错后隔几题重出，直到答对", () => {
    const queue = buildRound(ids("d", 8), []);
    const next = afterAnswer(queue, false);
    expect(next).toHaveLength(8);
    expect(next[REPEAT_GAP]).toEqual({ chunkId: "d0", phase: "review", retry: true });
    expect(next.slice(0, REPEAT_GAP).map((q) => q.chunkId)).toEqual(["d1", "d2", "d3", "d4"]);
  });

  it("重出不越过本阶段：阶段剩余题目不够时排在阶段末尾", () => {
    const queue = buildRound(["d0", "d1"], ["n0"]);
    const next = afterAnswer(queue, false);
    expect(next.map((q) => `${q.phase}:${q.chunkId}`)).toEqual([
      "review:d1",
      "review:d0",
      "copy:n0",
      "cloze:n0",
      "recall:n0",
    ]);
    // 填空阶段只剩它自己：立刻再出
    let cloze = buildRound([], ["n0"]).slice(1);
    cloze = afterAnswer(cloze, false);
    expect(cloze[0]).toEqual({ chunkId: "n0", phase: "cloze", retry: true });
    expect(cloze[1]?.phase).toBe("recall");
  });

  it("删除句块时去掉它在各阶段的所有题", () => {
    const queue = buildRound(["a"], ["b", "c"]);
    expect(withoutChunk(queue, "b").map((q) => q.chunkId)).toEqual(["a", "c", "c", "c"]);
  });

  it("各阶段进度：重出不重复计数，删除的句块不计", () => {
    const initial = buildRound(["d0", "d1"], ["n0", "n1"]);
    let queue = afterAnswer(initial, false); // d0 答错重出
    queue = afterAnswer(queue, true); // d1 答对
    expect(phaseProgress(initial, queue)).toEqual([
      { phase: "review", total: 2, done: 1 },
      { phase: "copy", total: 2, done: 0 },
      { phase: "cloze", total: 2, done: 0 },
      { phase: "recall", total: 2, done: 0 },
    ]);
    queue = withoutChunk(queue, "n1");
    expect(phaseProgress(initial, queue, new Set(["n1"]))[1]).toEqual({
      phase: "copy",
      total: 1,
      done: 0,
    });
    expect(phaseProgress(initial, [])).toEqual(
      ["review", "copy", "cloze", "recall"].map((phase) => ({ phase, total: 2, done: 2 })),
    );
  });
});

describe("连续学习天数", () => {
  it("完成当天开始时已到期的全部复习才算", () => {
    expect(
      isDayComplete({ dueAtStart: ["a", "b"], answered: new Set(["a"]), answerCount: 1 }),
    ).toBe(false);
    expect(
      isDayComplete({ dueAtStart: ["a", "b"], answered: new Set(["a", "b", "c"]), answerCount: 3 }),
    ).toBe(true);
  });

  it("当天开始时没有到期复习：有答题才算", () => {
    expect(isDayComplete({ dueAtStart: [], answered: new Set(), answerCount: 0 })).toBe(false);
    expect(isDayComplete({ dueAtStart: [], answered: new Set(["n"]), answerCount: 1 })).toBe(true);
  });

  it("连续天数从今天往前数", () => {
    const days = ["2026-11-10", "2026-11-11", "2026-11-12"];
    expect(computeStreak(days, "2026-11-12")).toBe(3);
  });

  it("今天还没完成时不算中断", () => {
    expect(computeStreak(["2026-11-10", "2026-11-11"], "2026-11-12")).toBe(2);
  });

  it("昨天没完成则中断", () => {
    expect(computeStreak(["2026-11-09", "2026-11-10"], "2026-11-12")).toBe(0);
    expect(computeStreak(["2026-11-09", "2026-11-12"], "2026-11-12")).toBe(1);
    expect(computeStreak([], "2026-11-12")).toBe(0);
  });
});

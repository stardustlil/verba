import { beforeEach, describe, expect, it } from "vitest";
import { addDays, dayStart, studyDay } from "../core/srs/day";
import { createArticle } from "./articles";
import {
  purgeDeletedChunks,
  softDeleteChunk,
  undoDeleteChunk,
  updateMeaning,
  ignoredKeys,
} from "./chunks";
import { type Db, newId } from "./db";
import { homeStats, refreshDay } from "./stats";
import {
  sessionChunks,
  introduceChunk,
  loadStudyChunk,
  markKnown,
  newAvailableToday,
  overrideAnswer,
  recordAnswer,
  undoMarkKnown,
} from "./study";
import { createNodeDb } from "./testing/nodeDb";

const DAY = "2026-11-12";
const noon = (day: string) => dayStart(day) + 8 * 3600_000;

const TEXT = [
  "The policy has drawn widespread attention. It rained heavily.",
  "In the wake of the crisis, he made up his mind.",
].join("\n\n");

/** 建一篇文章，并在每个句子上各放一个句块 */
async function seed(db: Db, lemmas: string[], createdAt = 1000): Promise<string[]> {
  const { articleId } = await createArticle(
    db,
    {
      title: "文章",
      sourceType: "paste",
      sourceRef: null,
      text: TEXT,
      selectedParagraphs: new Set(),
    },
    createdAt,
  );
  const sentences = await db.query<{ id: string; idx: number; text: string }>(
    "SELECT id, idx, text FROM sentences WHERE article_id = ? ORDER BY idx",
    [articleId],
  );
  const ids: string[] = [];
  for (const [i, lemma] of lemmas.entries()) {
    const sentence = sentences[i % sentences.length]!;
    const words = sentence.text.split(" ");
    const surface = words.slice(1, 3).join(" ");
    const id = newId();
    ids.push(id);
    await db.transaction([
      {
        sql: `INSERT INTO chunks (id, lemma, lemma_key, meaning, origin, created_at, sort_time, sort_sentence, sort_offset)
              VALUES (?, ?, ?, ?, 'ai', ?, ?, ?, ?)`,
        params: [id, lemma, lemma.toLowerCase(), `释义${i}`, createdAt, createdAt, sentence.idx, i],
      },
      {
        sql: `INSERT INTO examples (id, chunk_id, sentence_id, article_id, sentence_text, surface, start_in_sentence, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          newId(),
          id,
          sentence.id,
          articleId,
          sentence.text,
          surface,
          sentence.text.indexOf(surface),
          createdAt,
        ],
      },
    ]);
  }
  return ids;
}

async function answer(
  db: Db,
  chunkId: string,
  now: number,
  correct = true,
  extra: { viewedAnswer?: boolean; durationMs?: number; input?: string } = {},
) {
  const chunk = await loadStudyChunk(db, chunkId);
  const mode = chunk?.progress.stage === "recall" ? "recall" : "cloze";
  return recordAnswer(db, {
    chunkId,
    mode,
    exampleId: chunk?.examples[0]?.id ?? null,
    input: extra.input ?? "x",
    correct,
    viewedAnswer: extra.viewedAnswer ?? false,
    durationMs: extra.durationMs ?? 5000,
    slowMs: 30_000,
    now,
  });
}

let db: Db;
beforeEach(() => {
  db = createNodeDb();
});

describe("组一轮练习", () => {
  it("新句块按出场顺序，只取当天额度", async () => {
    const ids = await seed(db, ["a b", "c d", "e f"]);
    expect(await sessionChunks(db, 2, noon(DAY))).toEqual({
      dueIds: [],
      newIds: [ids[0], ids[1]],
    });
  });

  it("跟写过的句块：额度减少；未做首次填空就退出，下次作为复习出现", async () => {
    const ids = await seed(db, ["a b", "c d", "e f"]);
    await introduceChunk(db, ids[0]!, noon(DAY));
    expect(await newAvailableToday(db, 2, noon(DAY))).toBe(1);
    expect(await sessionChunks(db, 1, noon(DAY))).toEqual({
      dueIds: [ids[0]],
      newIds: [ids[1]],
    });
  });

  it("答过的句块安排到以后，今天不再出；到期那天再出", async () => {
    const [id] = await seed(db, ["a b"]);
    await introduceChunk(db, id!, noon(DAY));
    await answer(db, id!, noon(DAY));
    expect(await sessionChunks(db, 0, noon(DAY))).toEqual({ dueIds: [], newIds: [] });
    const chunk = await loadStudyChunk(db, id!);
    const dueDay = studyDay(chunk!.progress.due!);
    expect(await sessionChunks(db, 0, noon(dueDay))).toEqual({ dueIds: [id], newIds: [] });
  });

  it("新的一天额度重新计算", async () => {
    const ids = await seed(db, ["a b", "c d", "e f"]);
    await introduceChunk(db, ids[0]!, noon(DAY));
    await introduceChunk(db, ids[1]!, noon(DAY));
    expect(await newAvailableToday(db, 2, noon(DAY))).toBe(0);
    expect(await newAvailableToday(db, 2, noon(addDays(DAY, 1)))).toBe(1);
  });

  it("额外练习：只有新句块、不含复习，学过的不占每日额度", async () => {
    await seed(db, ["a b", "c d", "e f", "g h"]);
    // 按出场顺序
    const ids = (await sessionChunks(db, 4, noon(DAY))).newIds;
    await introduceChunk(db, ids[0]!, noon(DAY));
    // ids[0] 跟写过还没答，作为复习；额外练习不出它
    expect(await sessionChunks(db, 2, noon(DAY), { extra: true })).toEqual({
      dueIds: [],
      newIds: [ids[1], ids[2]],
    });
    const before = await homeStats(db, 3, noon(DAY));
    await introduceChunk(db, ids[1]!, noon(DAY), true);
    await introduceChunk(db, ids[2]!, noon(DAY), true);
    expect(await newAvailableToday(db, 3, noon(DAY))).toBe(1);
    const after = await homeStats(db, 3, noon(DAY));
    // 库里只剩一个新句块，所以 newToday 从 2 变成 1；额度本身（3 - 1）没变
    expect(before.newToday).toBe(2);
    expect(after.newToday).toBe(1);
    expect(await sessionChunks(db, 1, noon(DAY))).toEqual({
      dueIds: [ids[0], ids[1], ids[2]],
      newIds: [ids[3]],
    });
  });
});

describe("记录答题", () => {
  it("每天只有第一次答题计入调度，本轮重出只写记录", async () => {
    const [id] = await seed(db, ["a b"]);
    await introduceChunk(db, id!, noon(DAY));
    const first = await answer(db, id!, noon(DAY), false);
    expect(first.counted).toBe(true);
    expect(first.rating).toBe("again");
    const afterFirst = (await loadStudyChunk(db, id!))!.progress;
    expect(afterFirst.fsrsCard).not.toBeNull();

    const retry = await answer(db, id!, noon(DAY) + 60_000, true);
    expect(retry.counted).toBe(false);
    expect((await loadStudyChunk(db, id!))!.progress).toEqual(afterFirst);

    const reviews = await db.query<{ counted: number; rating: string }>(
      "SELECT counted, rating FROM reviews ORDER BY answered_at",
    );
    expect(reviews).toEqual([
      { counted: 1, rating: "again" },
      { counted: 0, rating: "good" },
    ]);
  });

  it("语境填空在不同的天连续答对 2 次后升级为纯中文默写", async () => {
    const [id] = await seed(db, ["a b"]);
    await introduceChunk(db, id!, noon(DAY));
    await answer(db, id!, noon(DAY));
    // 同一天再答对不算第二次
    await answer(db, id!, noon(DAY) + 1000);
    expect((await loadStudyChunk(db, id!))!.progress.stage).toBe("cloze");
    const due = (await loadStudyChunk(db, id!))!.progress.due!;
    await answer(db, id!, noon(studyDay(due)));
    const progress = (await loadStudyChunk(db, id!))!.progress;
    expect(progress.stage).toBe("recall");
    expect(progress.exampleCursor).toBe(2);
  });

  it("用时超过“写得慢”的时长评为一般；看过答案评为忘了", async () => {
    const [a, b] = await seed(db, ["a b", "c d"]);
    expect((await answer(db, a!, noon(DAY), true, { durationMs: 31_000 })).rating).toBe("hard");
    expect((await answer(db, b!, noon(DAY), true, { viewedAnswer: true })).rating).toBe("again");
  });

  it("“我写的也对”：计入调度的那次按“好”重新调度", async () => {
    const [a, b] = await seed(db, ["a b", "c d"]);
    await introduceChunk(db, a!, noon(DAY));
    await introduceChunk(db, b!, noon(DAY));
    await answer(db, a!, noon(DAY), true);
    const expected = (await loadStudyChunk(db, a!))!.progress;

    const wrong = await answer(db, b!, noon(DAY), false);
    await overrideAnswer(db, wrong, noon(DAY) + 1000);
    const progress = (await loadStudyChunk(db, b!))!.progress;
    expect(progress.due).toBe(expected.due);
    expect(progress.clozeStreak).toBe(1);
    const [review] = await db.query<{ rating: string; overridden: number }>(
      "SELECT rating, overridden FROM reviews WHERE id = ?",
      [wrong.reviewId],
    );
    expect(review).toEqual({ rating: "good", overridden: 1 });
  });

  it("“我写的也对”：纯中文默写中存为备选答案，语境填空中不存", async () => {
    const [a] = await seed(db, ["draw attention"]);
    await db.transaction([{ sql: "UPDATE chunks SET stage = 'recall'", params: [] }]);
    const wrong = await answer(db, a!, noon(DAY), false, { input: "attract  attention" });
    await overrideAnswer(db, wrong, noon(DAY));
    // 同样的写法不重复存
    const again = await answer(db, a!, noon(DAY), false, { input: "Attract attention" });
    await overrideAnswer(db, again, noon(DAY));
    expect((await loadStudyChunk(db, a!))!.altAnswers).toEqual(["attract attention"]);

    await db.transaction([{ sql: "UPDATE chunks SET stage = 'cloze'", params: [] }]);
    const cloze = await answer(db, a!, noon(DAY), false, { input: "other words" });
    await overrideAnswer(db, cloze, noon(DAY));
    expect((await loadStudyChunk(db, a!))!.altAnswers).toEqual(["attract attention"]);
  });
});

describe("删除与撤销", () => {
  it("删除后原形进入忽略名单，撤销后恢复且撤回忽略名单", async () => {
    const [a] = await seed(db, ["Draw Attention"]);
    const deleted = await softDeleteChunk(db, a!, 5);
    expect(await loadStudyChunk(db, a!)).toBeNull();
    expect(await ignoredKeys(db)).toEqual(new Set(["draw attention"]));
    await undoDeleteChunk(db, deleted);
    expect(await loadStudyChunk(db, a!)).not.toBeNull();
    expect(await ignoredKeys(db)).toEqual(new Set());
  });

  it("原形早已在忽略名单中时，撤销不会把它撤回", async () => {
    const [a] = await seed(db, ["draw attention"]);
    await db.transaction([
      { sql: "INSERT INTO ignored_lemmas VALUES ('draw attention', 1)", params: [] },
    ]);
    await undoDeleteChunk(db, await softDeleteChunk(db, a!));
    expect(await ignoredKeys(db)).toEqual(new Set(["draw attention"]));
  });

  it("启动时彻底清除软删除的句块", async () => {
    const [a, b] = await seed(db, ["a b", "c d"]);
    await answer(db, a!, noon(DAY));
    await softDeleteChunk(db, a!);
    await purgeDeletedChunks(db);
    const rows = await db.query<{ id: string }>("SELECT id FROM chunks");
    expect(rows.map((r) => r.id)).toEqual([b]);
    expect(await db.query("SELECT * FROM reviews")).toEqual([]);
  });

  it("修改释义", async () => {
    const [a] = await seed(db, ["a b"]);
    await updateMeaning(db, a!, "  新释义 ");
    expect((await loadStudyChunk(db, a!))!.meaning).toBe("新释义");
    await expect(updateMeaning(db, a!, " ")).rejects.toThrow();
  });
});

describe("首页数据与连续天数", () => {
  it("待复习、新句块、已完成、已掌握、总数", async () => {
    await seed(db, ["a b", "c d", "e f", "g h"]);
    // 按出场顺序
    const ids = (await sessionChunks(db, 4, noon(DAY))).newIds;
    await introduceChunk(db, ids[0]!, noon(DAY));
    await introduceChunk(db, ids[1]!, noon(DAY));
    let stats = await homeStats(db, 3, noon(DAY));
    expect(stats).toMatchObject({ dueToday: 2, newToday: 1, doneToday: 0, total: 4 });

    await answer(db, ids[0]!, noon(DAY));
    await db.transaction([
      { sql: "UPDATE chunks SET scheduled_days = 30 WHERE id = ?", params: [ids[0]!] },
    ]);
    stats = await homeStats(db, 3, noon(DAY));
    expect(stats).toMatchObject({ dueToday: 1, doneToday: 1, mastered: 1 });
  });

  it("当天开始时没有到期复习：有答题才算一天", async () => {
    const [a] = await seed(db, ["a b"]);
    expect((await homeStats(db, 20, noon(DAY))).streak).toBe(0);
    await introduceChunk(db, a!, noon(DAY));
    await answer(db, a!, noon(DAY));
    expect((await homeStats(db, 20, noon(DAY))).streak).toBe(1);
  });

  it("完成当天开始时已到期的全部复习才算一天，新句块不要求", async () => {
    const [a, b, c] = await seed(db, ["a b", "c d", "e f"]);
    const yesterday = addDays(DAY, -1);
    for (const id of [a!, b!]) {
      await introduceChunk(db, id, noon(yesterday));
      await answer(db, id, noon(yesterday), false);
    }
    expect((await homeStats(db, 20, noon(yesterday))).streak).toBe(1);

    // 今天开始时 a、b 都到期
    expect((await homeStats(db, 20, noon(DAY))).dueToday).toBe(2);
    await answer(db, a!, noon(DAY));
    expect(await refreshDay(db, DAY)).toBe(false);
    expect((await homeStats(db, 20, noon(DAY))).streak).toBe(1);
    // 当天新认识的句块不影响
    await introduceChunk(db, c!, noon(DAY));
    await answer(db, b!, noon(DAY));
    expect(await refreshDay(db, DAY)).toBe(true);
    expect((await homeStats(db, 20, noon(DAY))).streak).toBe(2);
  });

  it("已完成的一天保持完成：之后删掉当天答过的句块也不影响", async () => {
    const [a] = await seed(db, ["a b"]);
    await introduceChunk(db, a!, noon(DAY));
    await answer(db, a!, noon(DAY));
    expect((await homeStats(db, 20, noon(DAY))).streak).toBe(1);
    await softDeleteChunk(db, a!);
    await purgeDeletedChunks(db);
    expect((await homeStats(db, 20, noon(DAY))).streak).toBe(1);
  });

  it("删除到期的句块后，剩下的都完成也算一天", async () => {
    const [a, b] = await seed(db, ["a b", "c d"]);
    const yesterday = addDays(DAY, -1);
    for (const id of [a!, b!]) {
      await introduceChunk(db, id, noon(yesterday));
      await answer(db, id, noon(yesterday), false);
    }
    await homeStats(db, 20, noon(DAY));
    await answer(db, a!, noon(DAY));
    await softDeleteChunk(db, b!);
    expect(await refreshDay(db, DAY)).toBe(true);
  });
});

describe("标记熟练", () => {
  it("新短语：直接进入默写、排到 60 天后，算已掌握，不占当天额度；撤销后恢复", async () => {
    const [a] = await seed(db, ["a b", "c d"]);
    expect(await newAvailableToday(db, 1, noon(DAY))).toBe(1);
    const mark = await markKnown(db, a!, noon(DAY));
    const chunk = await loadStudyChunk(db, a!);
    expect(chunk?.progress.stage).toBe("recall");
    expect(chunk?.progress.scheduledDays).toBeGreaterThanOrEqual(60);
    expect(studyDay(chunk!.progress.due!) > addDays(DAY, 59)).toBe(true);
    // 不占额度，今天也不会再出
    expect(await newAvailableToday(db, 1, noon(DAY))).toBe(1);
    expect((await sessionChunks(db, 5, noon(DAY))).newIds).not.toContain(a);
    expect((await homeStats(db, 20, noon(DAY))).mastered).toBe(1);
    expect(await db.query("SELECT * FROM reviews")).toHaveLength(0);

    await undoMarkKnown(db, mark, noon(DAY));
    const back = await loadStudyChunk(db, a!);
    expect(back?.progress).toEqual(mark.before);
    expect((await sessionChunks(db, 5, noon(DAY))).newIds).toContain(a);
  });

  it("到期的复习标记熟练后不再拦着打卡；撤销后恢复", async () => {
    const [a, b] = await seed(db, ["a b", "c d"]);
    const yesterday = addDays(DAY, -1);
    for (const id of [a!, b!]) {
      await introduceChunk(db, id, noon(yesterday));
      await answer(db, id, noon(yesterday), false);
    }
    expect((await homeStats(db, 20, noon(DAY))).dueToday).toBe(2);
    await answer(db, a!, noon(DAY));
    expect(await refreshDay(db, DAY)).toBe(false);
    const mark = await markKnown(db, b!, noon(DAY));
    expect((await homeStats(db, 20, noon(DAY))).dueToday).toBe(0);
    expect(await refreshDay(db, DAY)).toBe(true);
    await undoMarkKnown(db, mark, noon(DAY));
    expect((await homeStats(db, 20, noon(DAY))).dueToday).toBe(1);
  });
});

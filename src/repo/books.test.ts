import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_BOOKS } from "../data/books";
import { createArticle } from "./articles";
import {
  type BookData,
  MY_BOOK,
  currentBookId,
  listBooks,
  nextNewChunks,
  seedBuiltinBooks,
  setCurrentBook,
} from "./books";
import { purgeDeletedChunks, softDeleteChunk } from "./chunks";
import type { Db } from "./db";
import { addManualChunk, chunkDetail, listChunks } from "./library";
import { introduceChunk, loadStudyChunk, newAvailableToday, sessionChunks } from "./study";
import { createNodeDb, migrateNodeDb, wrapNodeDb } from "./testing/nodeDb";

const entry = (lemma: string, surface: string, example: string) => ({
  lemma,
  surface,
  meaning: `${lemma} 的意思`,
  example,
  translation: "例句翻译。",
});

const VERBS: BookData = {
  id: "verbs",
  title: "动词短语",
  description: "常用动词短语",
  color: "violet",
  version: 1,
  entries: [
    entry("take advantage of", "took advantage of", "She took advantage of the quiet morning."),
    entry("give up", "gave up", "He never gave up on his dream."),
    entry("make up one's mind", "made up her mind", "She finally made up her mind to move."),
  ],
};

const PREPS: BookData = {
  id: "preps",
  title: "介词短语",
  description: "",
  color: "amber",
  version: 1,
  entries: [
    entry("in the wake of", "In the wake of", "In the wake of the storm, roads were closed."),
    entry("give up", "give up", "Don't give up so easily."),
  ],
};

let db: Db;
beforeEach(() => {
  db = createNodeDb();
});

describe("写入内置词书", () => {
  it("写入书、句块、例句和翻译；第一本是默认的当前词书", async () => {
    await seedBuiltinBooks(db, [VERBS, PREPS], 1000);
    const books = await listBooks(db);
    expect(books.map((b) => [b.id, b.total, b.learned])).toEqual([
      ["verbs", 3, 0],
      ["preps", 2, 0],
      [MY_BOOK, 0, 0],
    ]);
    expect(await currentBookId(db)).toBe("verbs");
    const [first] = await nextNewChunks(db, "verbs", 1);
    const chunk = await loadStudyChunk(db, first!);
    expect(chunk?.lemma).toBe("take advantage of");
    expect(chunk?.examples[0]).toMatchObject({
      surface: "took advantage of",
      start: 4,
      translation: "例句翻译。",
      articleId: null,
      sourceTitle: "动词短语",
    });
  });

  it("同一个原形出现在两本书里：共用一个句块，补一个例句", async () => {
    await seedBuiltinBooks(db, [VERBS, PREPS], 1000);
    const giveUp = await listChunks(db, { search: "give up" });
    expect(giveUp).toHaveLength(1);
    expect((await chunkDetail(db, giveUp[0]!.id))?.examples).toHaveLength(2);
    expect(await nextNewChunks(db, "preps", 5)).toHaveLength(2);
  });

  it("重复执行不会重复写入；版本变化时只补新条目", async () => {
    await seedBuiltinBooks(db, [VERBS], 1000);
    await seedBuiltinBooks(db, [VERBS], 2000);
    expect(await db.query("SELECT * FROM examples")).toHaveLength(3);
    const v2 = {
      ...VERBS,
      version: 2,
      entries: [...VERBS.entries, entry("look after", "looks after", "He looks after his sister.")],
    };
    await seedBuiltinBooks(db, [v2], 3000);
    expect(await db.query("SELECT * FROM examples")).toHaveLength(4);
    expect((await listBooks(db))[0]?.total).toBe(4);
  });

  it("用户删过的条目不会因版本更新而复活", async () => {
    await seedBuiltinBooks(db, [VERBS], 1000);
    const [id] = await nextNewChunks(db, "verbs", 1);
    await softDeleteChunk(db, id!);
    await purgeDeletedChunks(db);
    await seedBuiltinBooks(db, [{ ...VERBS, version: 2 }], 2000);
    expect((await listBooks(db))[0]?.total).toBe(2);
  });

  it("库里已有同原形的句块：挂到书上，不另建", async () => {
    const { articleId } = await createArticle(
      db,
      {
        title: "文章",
        sourceType: "paste",
        sourceRef: null,
        text: "They gave up early.",
        selectedParagraphs: new Set(),
      },
      500,
    );
    const [s] = await db.query<{ id: string }>("SELECT id FROM sentences");
    const mine = await addManualChunk(db, {
      articleId,
      sentenceId: s!.id,
      surface: "gave up",
      startInSentence: 5,
      lemma: "give up",
      meaning: "放弃",
    });
    await seedBuiltinBooks(db, [VERBS], 1000);
    const books = await listBooks(db);
    expect(books.find((b) => b.id === "verbs")?.total).toBe(3);
    expect(books.find((b) => b.id === MY_BOOK)?.total).toBe(1);
    expect((await chunkDetail(db, mine.chunkId))?.examples).toHaveLength(2);
    expect(await listChunks(db, { bookId: MY_BOOK })).toHaveLength(1);
    expect(await listChunks(db, { bookId: "verbs" })).toHaveLength(3);
    const ordered = await listChunks(db, { bookId: "verbs", sort: "book" });
    expect(ordered.map((c) => c.lemma)).toEqual(VERBS.entries.map((e) => e.lemma));
  });
});

describe("内置的三本书", () => {
  it("全部写入，每个条目都有可用的例句", async () => {
    await seedBuiltinBooks(db, BUILTIN_BOOKS, 1000);
    const books = await listBooks(db);
    for (const book of BUILTIN_BOOKS) {
      expect(books.find((b) => b.id === book.id)?.total).toBe(book.entries.length);
    }
    const [missing] = await db.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM chunks c WHERE NOT EXISTS (SELECT 1 FROM examples e WHERE e.chunk_id = c.id)",
    );
    expect(missing?.n).toBe(0);
  });
});

describe("当前词书", () => {
  it("新句块从当前词书中按顺序取，额度也按当前词书算", async () => {
    await seedBuiltinBooks(db, [VERBS, PREPS], 1000);
    const noon = new Date(2026, 10, 12, 12).getTime();
    let session = await sessionChunks(db, 2, noon);
    expect(session.dueIds).toEqual([]);
    const lemmas = async (ids: string[]) =>
      Promise.all(ids.map(async (id) => (await loadStudyChunk(db, id))?.lemma));
    expect(await lemmas(session.newIds)).toEqual(["take advantage of", "give up"]);

    await setCurrentBook(db, "preps");
    expect(await currentBookId(db)).toBe("preps");
    session = await sessionChunks(db, 5, noon);
    expect(await lemmas(session.newIds)).toEqual(["in the wake of", "give up"]);

    // give up 在另一本书里学过了，这本书里就只剩一个新句块
    await introduceChunk(db, session.newIds[1]!, noon);
    expect(await newAvailableToday(db, 20, noon)).toBe(1);
    expect((await listBooks(db))[0]?.learned).toBe(1);
  });

  it("设成不存在的书时退回第一本", async () => {
    await seedBuiltinBooks(db, [VERBS], 1000);
    await setCurrentBook(db, "gone");
    expect(await currentBookId(db)).toBe("verbs");
    await setCurrentBook(db, MY_BOOK);
    expect(await currentBookId(db)).toBe(MY_BOOK);
  });
});

describe("迁移", () => {
  it("旧版本（只有 001）的数据升级后完整保留", async () => {
    const database = new DatabaseSync(":memory:");
    migrateNodeDb(database, 1);
    database.exec(`
      INSERT INTO articles (id, title, source_type, text, created_at) VALUES ('a', 't', 'paste', 'He ran into her.', 0);
      INSERT INTO sentences (id, article_id, idx, paragraph_idx, text, start_offset, end_offset) VALUES ('s', 'a', 0, 0, 'He ran into her.', 0, 16);
      INSERT INTO chunks (id, lemma, lemma_key, meaning, origin, created_at, sort_time, sort_sentence, sort_offset, stage) VALUES ('c', 'run into', 'run into', '偶遇', 'ai', 0, 0, 0, 3, 'cloze');
      INSERT INTO examples (id, chunk_id, sentence_id, article_id, surface, start_in_sentence, created_at) VALUES ('e', 'c', 's', 'a', 'ran into', 3, 0);
      INSERT INTO reviews (id, chunk_id, mode, answered_at, study_day, input, rating, counted, duration_ms) VALUES ('r', 'c', 'cloze', 0, '2026-11-12', 'ran into', 'good', 1, 1000);
    `);
    migrateNodeDb(database);
    const upgraded = wrapNodeDb(database);
    const chunk = await chunkDetail(upgraded, "c");
    expect(chunk?.examples[0]).toMatchObject({
      sentence: "He ran into her.",
      sourceTitle: "t",
      articleId: "a",
    });
    expect(chunk?.reviews).toHaveLength(1);
    expect(chunk?.stage).toBe("cloze");
  });
});

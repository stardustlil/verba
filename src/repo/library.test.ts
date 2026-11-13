import { beforeEach, describe, expect, it } from "vitest";
import { dayStart } from "../core/srs/day";
import { createArticle } from "./articles";
import { softDeleteChunk } from "./chunks";
import type { Db } from "./db";
import {
  addManualChunk,
  articleDetail,
  chunkDetail,
  chunksWithLemma,
  listArticles,
  listChunks,
} from "./library";
import { introduceChunk, recordAnswer } from "./study";
import { createNodeDb } from "./testing/nodeDb";

const TEXT = [
  "The policy has drawn widespread attention. It rained heavily.",
  "In the wake of the crisis, he made up his mind.",
].join("\n\n");

let db: Db;
let articleId: string;

async function sentence(idx: number) {
  const [s] = await db.query<{ id: string; text: string }>(
    "SELECT id, text FROM sentences WHERE article_id = ? AND idx = ?",
    [articleId, idx],
  );
  return s!;
}

async function add(
  idx: number,
  surface: string,
  lemma: string,
  meaning: string,
  mergeInto?: string,
) {
  const s = await sentence(idx);
  return addManualChunk(db, {
    articleId,
    sentenceId: s.id,
    surface,
    startInSentence: s.text.indexOf(surface),
    lemma,
    meaning,
    mergeInto,
    now: 2000 + idx,
  });
}

beforeEach(async () => {
  db = createNodeDb();
  ({ articleId } = await createArticle(
    db,
    {
      title: "文章一",
      sourceType: "url",
      sourceRef: "https://e.com",
      text: TEXT,
      selectedParagraphs: new Set([0]),
    },
    1000,
  ));
});

describe("手动添加句块", () => {
  it("新建句块，选中的文字作为原文形式", async () => {
    const { chunkId, merged } = await add(
      0,
      "drawn widespread attention",
      "draw widespread attention",
      "引起广泛关注",
    );
    expect(merged).toBe(false);
    const detail = await chunkDetail(db, chunkId);
    expect(detail).toMatchObject({
      lemma: "draw widespread attention",
      origin: "manual",
      status: "new",
    });
    expect(detail?.examples[0]).toMatchObject({
      surface: "drawn widespread attention",
      sourceTitle: "文章一",
    });
  });

  it("不受忽略名单限制", async () => {
    await db.transaction([{ sql: "INSERT INTO ignored_lemmas VALUES ('in the wake of', 1)" }]);
    const { chunkId } = await add(2, "In the wake of", "in the wake of", "在……之后");
    expect(await chunkDetail(db, chunkId)).not.toBeNull();
  });

  it("原形相同：可以合并为已有句块的例句", async () => {
    const first = await add(
      0,
      "drawn widespread attention",
      "draw widespread attention",
      "引起广泛关注",
    );
    expect(await chunksWithLemma(db, "Draw  widespread attention")).toHaveLength(1);
    const second = await add(1, "rained heavily", "draw widespread attention", "x", first.chunkId);
    expect(second).toEqual({ chunkId: first.chunkId, merged: true });
    expect((await chunkDetail(db, first.chunkId))?.examples).toHaveLength(2);
    // 同一个句子不重复添加
    await expect(
      add(1, "rained heavily", "draw widespread attention", "x", first.chunkId),
    ).rejects.toThrow("已经是该短语的例句");
  });

  it("校验：必填项、选中文字与原句一致", async () => {
    const s = await sentence(0);
    await expect(
      addManualChunk(db, {
        articleId,
        sentenceId: s.id,
        surface: "policy",
        startInSentence: 0,
        lemma: "p",
        meaning: "m",
      }),
    ).rejects.toThrow("不一致");
    await expect(add(0, "policy", " ", "m")).rejects.toThrow("原形");
    await expect(add(0, "policy", "p", " ")).rejects.toThrow("释义");
  });
});

describe("文章", () => {
  it("列表：句块数与学习进度", async () => {
    const a = await add(
      0,
      "drawn widespread attention",
      "draw widespread attention",
      "引起广泛关注",
    );
    await add(2, "made up his mind", "make up one's mind", "下定决心");
    await introduceChunk(db, a.chunkId, 3000);
    const [item] = await listArticles(db);
    expect(item).toMatchObject({
      title: "文章一",
      sourceType: "url",
      chunkCount: 2,
      learnedCount: 1,
    });
  });

  it("详情：句块在全文中的位置，删除的句块不显示", async () => {
    const a = await add(2, "made up his mind", "make up one's mind", "下定决心");
    const b = await add(
      0,
      "drawn widespread attention",
      "draw widespread attention",
      "引起广泛关注",
    );
    let detail = await articleDetail(db, articleId);
    expect(detail?.highlights.map((h) => TEXT.slice(h.start, h.start + h.length))).toEqual([
      "drawn widespread attention",
      "made up his mind",
    ]);
    expect(detail?.unfinishedBatches).toBe(1);
    await softDeleteChunk(db, b.chunkId);
    detail = await articleDetail(db, articleId);
    expect(detail?.highlights.map((h) => h.chunkId)).toEqual([a.chunkId]);
  });
});

describe("句块列表", () => {
  async function seedThree() {
    const a = await add(
      0,
      "drawn widespread attention",
      "draw widespread attention",
      "引起广泛关注",
    );
    const b = await add(1, "rained heavily", "rain heavily", "下大雨");
    const c = await add(2, "made up his mind", "make up one's mind", "下定决心");
    const noon = dayStart("2026-11-12") + 8 * 3600_000;
    for (const id of [a.chunkId, b.chunkId]) await introduceChunk(db, id, noon);
    const answer = (chunkId: string, correct: boolean) =>
      recordAnswer(db, {
        chunkId,
        mode: "cloze",
        exampleId: null,
        input: "x",
        correct,
        viewedAnswer: false,
        durationMs: 1000,
        slowMs: 30_000,
        now: noon,
      });
    await answer(a.chunkId, false);
    await answer(a.chunkId, false);
    await answer(b.chunkId, true);
    await db.transaction([
      {
        sql: "UPDATE chunks SET scheduled_days = 40, due = 9e15 WHERE id = ?",
        params: [b.chunkId],
      },
    ]);
    return { a: a.chunkId, b: b.chunkId, c: c.chunkId };
  }

  it("搜索英文、中文和备选答案", async () => {
    const { a, c } = await seedThree();
    expect((await listChunks(db, { search: "WIDESPREAD" })).map((x) => x.id)).toEqual([a]);
    expect((await listChunks(db, { search: "决心" })).map((x) => x.id)).toEqual([c]);
    await db.transaction([
      { sql: "INSERT INTO alt_answers VALUES ('x', ?, 'attract attention', 1)", params: [a] },
    ]);
    expect((await listChunks(db, { search: "attract" })).map((x) => x.id)).toEqual([a]);
    expect(await listChunks(db, { search: "100%" })).toEqual([]);
  });

  it("按状态、来源文章筛选", async () => {
    const { a, b, c } = await seedThree();
    expect((await listChunks(db, { status: "new" })).map((x) => x.id)).toEqual([c]);
    expect((await listChunks(db, { status: "learning" })).map((x) => x.id)).toEqual([a]);
    expect((await listChunks(db, { status: "mastered" })).map((x) => x.id)).toEqual([b]);
    expect(await listChunks(db, { articleId: "none" })).toEqual([]);
    expect(await listChunks(db, { articleId })).toHaveLength(3);
  });

  it("按添加时间、下次复习时间、出错次数排序", async () => {
    const { a, b, c } = await seedThree();
    expect((await listChunks(db, { sort: "added" })).map((x) => x.id)).toEqual([c, b, a]);
    expect((await listChunks(db, { sort: "due" })).map((x) => x.id)).toEqual([a, b, c]);
    const byErrors = await listChunks(db, { sort: "errors" });
    expect(byErrors[0]).toMatchObject({ id: a, errors: 2 });
  });

  it("详情：复习记录与备选答案", async () => {
    const { a } = await seedThree();
    const detail = await chunkDetail(db, a);
    expect(detail?.reviews.map((r) => [r.rating, r.counted])).toEqual([
      ["again", false],
      ["again", true],
    ]);
    expect(detail?.altAnswers).toEqual([]);
  });
});

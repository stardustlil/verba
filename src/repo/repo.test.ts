import { beforeEach, describe, expect, it } from "vitest";
import type { AiClient, ChatMessage } from "../core/extract/types";
import { countChunksOnlyIn, createArticle, deleteArticle, pendingBatches } from "./articles";
import type { Db } from "./db";
import { runExtraction } from "./importer";
import { DEFAULT_SETTINGS, getSettings, saveSettings } from "./settings";
import { createNodeDb } from "./testing/nodeDb";

interface Item {
  s: number;
  text: string;
  lemma: string;
  zh: string;
}

/**
 * 按规则作答的假 AI：
 * extract 收到这一批的句子，返回要“抽出”的条目；sense 收到查询文本，返回各条的 match。
 */
function scriptedAi(script: {
  extract: (sentences: string[]) => Item[];
  sense?: (content: string) => number[];
}): AiClient & { extractCalls: number; senseCalls: number } {
  const client = {
    extractCalls: 0,
    senseCalls: 0,
    async chat(messages: ChatMessage[]) {
      const content = messages[1]?.content ?? "";
      if (messages[0]?.content.includes("义项")) {
        client.senseCalls++;
        const matches = script.sense?.(content) ?? [];
        return JSON.stringify({ results: matches.map((match, i) => ({ id: i + 1, match })) });
      }
      client.extractCalls++;
      const sentences = [...content.matchAll(/^\[\d+\] (.*)$/gm)].map((m) => m[1] ?? "");
      return JSON.stringify({ chunks: script.extract(sentences) });
    },
  };
  return client;
}

/** 在句子里找到短语就“抽出”它 */
function phraseExtractor(phrases: Array<{ text: string; lemma: string; zh: string }>) {
  return (sentences: string[]): Item[] =>
    sentences.flatMap((sentence, i) =>
      phrases.filter((p) => sentence.includes(p.text)).map((p) => ({ s: i + 1, ...p })),
    );
}

const ARTICLE_A = [
  "The policy has drawn widespread attention. It rained all day.",
  "This paragraph is not selected at all.",
  "In the wake of the crisis, he made up his mind.",
].join("\n\n");

const PHRASES = [
  { text: "drawn widespread attention", lemma: "draw widespread attention", zh: "引起广泛关注" },
  { text: "In the wake of", lemma: "in the wake of", zh: "在……之后" },
  { text: "made up his mind", lemma: "make up one's mind", zh: "下定决心" },
  { text: "ran into", lemma: "run into", zh: "偶然遇到" },
];

async function importArticle(
  db: Db,
  ai: AiClient,
  text: string,
  selected: number[],
  createdAt = 1000,
) {
  const { articleId, batchCount } = await createArticle(
    db,
    {
      title: "T",
      sourceType: "paste",
      sourceRef: null,
      text,
      selectedParagraphs: new Set(selected),
    },
    createdAt,
  );
  const summary = await runExtraction(db, ai, articleId, { now: () => createdAt + 1 });
  return { articleId, batchCount, summary };
}

let db: Db;
beforeEach(() => {
  db = createNodeDb();
});

describe("createArticle", () => {
  it("保存正文、句子和选中范围，只为选中的段落建批次", async () => {
    const { articleId, batchCount } = await createArticle(db, {
      title: "标题",
      sourceType: "url",
      sourceRef: "https://example.com/a",
      text: ARTICLE_A,
      selectedParagraphs: new Set([0, 2]),
    });
    const sentences = await db.query<{ idx: number; selected: number; text: string }>(
      "SELECT idx, selected, text FROM sentences WHERE article_id = ? ORDER BY idx",
      [articleId],
    );
    expect(sentences.map((s) => s.selected)).toEqual([1, 1, 0, 1]);
    // 两个选中的段落不相邻，分成两批
    expect(batchCount).toBe(2);
    const batches = await pendingBatches(db, articleId);
    expect(batches.map((b) => b.sentences.map((s) => s.idx))).toEqual([[0, 1], [3]]);
    expect(batches.every((b) => b.status === "pending")).toBe(true);
  });

  it("没有选中任何段落时不建批次", async () => {
    const { batchCount } = await createArticle(db, {
      title: "T",
      sourceType: "paste",
      sourceRef: null,
      text: ARTICLE_A,
      selectedParagraphs: new Set(),
    });
    expect(batchCount).toBe(0);
  });
});

describe("runExtraction", () => {
  it("抽取结果入库：句块、例句、出场顺序", async () => {
    const ai = scriptedAi({ extract: phraseExtractor(PHRASES) });
    const { articleId, summary } = await importArticle(db, ai, ARTICLE_A, [0, 2]);
    expect(summary).toEqual({
      added: 3,
      merged: 0,
      batches: 2,
      failedBatches: 0,
      firstError: null,
    });

    const chunks = await db.query<Record<string, string | number | null>>(
      "SELECT lemma, lemma_key, meaning, origin, stage, sort_time, sort_sentence, sort_offset FROM chunks ORDER BY sort_time, sort_sentence, sort_offset",
    );
    expect(chunks.map((c) => c.lemma)).toEqual([
      "draw widespread attention",
      "in the wake of",
      "make up one's mind",
    ]);
    expect(chunks[0]).toMatchObject({
      origin: "ai",
      stage: "new",
      sort_time: 1000,
      sort_sentence: 0,
    });
    expect(chunks[1]).toMatchObject({ sort_sentence: 3, sort_offset: 0 });

    const examples = await db.query<{ surface: string; text: string; article_id: string }>(
      "SELECT e.surface, s.text, e.article_id FROM examples e JOIN sentences s ON s.id = e.sentence_id ORDER BY s.idx, e.start_in_sentence",
    );
    expect(examples.map((e) => e.surface)).toEqual([
      "drawn widespread attention",
      "In the wake of",
      "made up his mind",
    ]);
    expect(examples.every((e) => e.article_id === articleId)).toBe(true);
    expect(await pendingBatches(db, articleId)).toEqual([]);
  });

  it("没有选中的段落不会发给 AI", async () => {
    const seen: string[] = [];
    const ai = scriptedAi({
      extract: (sentences) => {
        seen.push(...sentences);
        return [];
      },
    });
    await importArticle(db, ai, ARTICLE_A, [0, 2]);
    expect(seen.some((s) => s.includes("not selected"))).toBe(false);
  });

  it("原形在忽略名单中的不入库", async () => {
    await db.transaction([
      { sql: "INSERT INTO ignored_lemmas (lemma_key, created_at) VALUES ('in the wake of', 0)" },
    ]);
    const ai = scriptedAi({ extract: phraseExtractor(PHRASES) });
    const { summary } = await importArticle(db, ai, ARTICLE_A, [0, 2]);
    expect(summary.added).toBe(2);
    const rows = await db.query("SELECT 1 FROM chunks WHERE lemma_key = 'in the wake of'");
    expect(rows).toEqual([]);
  });

  it("重复导入同一篇文章：不新建句块，也不重复添加例句", async () => {
    const ai = scriptedAi({
      extract: phraseExtractor(PHRASES),
      sense: (c) => c.split("\n#").map(() => 1),
    });
    await importArticle(db, ai, ARTICLE_A, [0, 2]);
    const second = await importArticle(db, ai, ARTICLE_A, [0, 2], 2000);
    expect(second.summary).toMatchObject({ added: 0, merged: 0, failedBatches: 0 });
    const [counts] = await db.query<{ chunks: number; examples: number }>(
      "SELECT (SELECT COUNT(*) FROM chunks) AS chunks, (SELECT COUNT(*) FROM examples) AS examples",
    );
    expect(counts).toEqual({ chunks: 3, examples: 3 });
  });

  it("重复导入时 AI 给出的原形写法不同，也不会重复建句块", async () => {
    const sentence = "Trams are well-suited to dense city centers.";
    const first = phraseExtractor([
      { text: "are well-suited to", lemma: "be well-suited to", zh: "非常适合" },
    ]);
    const second = phraseExtractor([
      { text: "are well-suited to", lemma: "are well-suited to", zh: "很适合" },
    ]);
    await importArticle(db, scriptedAi({ extract: first }), sentence, [0]);
    const ai = scriptedAi({ extract: second });
    const again = await importArticle(db, ai, sentence, [0], 2000);
    expect(again.summary).toMatchObject({ added: 0, merged: 0, failedBatches: 0 });
    expect(ai.senseCalls).toBe(0);
    const chunks = await db.query<{ lemma: string }>("SELECT lemma FROM chunks");
    expect(chunks).toEqual([{ lemma: "be well-suited to" }]);
  });

  it("另一篇文章里的同一义项：并入为例句，已有释义和进度不变", async () => {
    const ai = scriptedAi({ extract: phraseExtractor(PHRASES), sense: () => [1] });
    await importArticle(db, ai, "I ran into an old friend at the airport.", [0]);
    await db.transaction([{ sql: "UPDATE chunks SET stage = 'recall', cloze_streak = 2" }]);

    const other = phraseExtractor([{ text: "ran into", lemma: "Run into", zh: "碰见" }]);
    const second = await importArticle(
      db,
      scriptedAi({ extract: other, sense: () => [1] }),
      "She ran into her teacher at the market.",
      [0],
      2000,
    );
    expect(second.summary).toMatchObject({ added: 0, merged: 1 });
    const chunks = await db.query<{ meaning: string; stage: string; n: number }>(
      "SELECT meaning, stage, (SELECT COUNT(*) FROM examples e WHERE e.chunk_id = chunks.id) AS n FROM chunks",
    );
    expect(chunks).toEqual([{ meaning: "偶然遇到", stage: "recall", n: 2 }]);
  });

  it("另一篇文章里的新义项：新建句块", async () => {
    await importArticle(
      db,
      scriptedAi({ extract: phraseExtractor(PHRASES) }),
      "I ran into an old friend at the airport.",
      [0],
    );
    const other = phraseExtractor([{ text: "ran into", lemma: "run into", zh: "撞上" }]);
    const second = await importArticle(
      db,
      scriptedAi({ extract: other, sense: () => [0] }),
      "The truck ran into a wall.",
      [0],
      2000,
    );
    expect(second.summary).toMatchObject({ added: 1, merged: 0 });
    const chunks = await db.query<{ meaning: string }>(
      "SELECT meaning FROM chunks WHERE lemma_key = 'run into' ORDER BY created_at",
    );
    expect(chunks.map((c) => c.meaning)).toEqual(["偶然遇到", "撞上"]);
  });

  it("每个句块最多 5 个例句", async () => {
    const ai = scriptedAi({
      extract: phraseExtractor(PHRASES),
      sense: (c) => c.split("\n#").map(() => 1),
    });
    for (let i = 0; i < 7; i++) {
      await importArticle(db, ai, `I ran into friend number ${i} at the airport.`, [0], 1000 + i);
    }
    const [row] = await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM examples");
    expect(row?.n).toBe(5);
    const [chunks] = await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM chunks");
    expect(chunks?.n).toBe(1);
  });

  it("某一批失败时其余批次照常入库，失败的可以重试", async () => {
    let failing = true;
    const ai = scriptedAi({
      extract: (sentences) => {
        if (failing && sentences.some((s) => s.includes("crisis"))) throw new Error("network down");
        return phraseExtractor(PHRASES)(sentences);
      },
    });
    const first = await importArticle(db, ai, ARTICLE_A, [0, 2]);
    expect(first.summary).toEqual({
      added: 1,
      merged: 0,
      batches: 2,
      failedBatches: 1,
      firstError: "network down",
    });
    const pending = await pendingBatches(db, first.articleId);
    expect(pending.map((b) => b.status)).toEqual(["failed"]);

    failing = false;
    const before = ai.extractCalls;
    const retry = await runExtraction(db, ai, first.articleId);
    expect(retry).toMatchObject({ added: 2, batches: 1, failedBatches: 0 });
    // 只重试失败的那一批
    expect(ai.extractCalls - before).toBe(1);
    expect(await pendingBatches(db, first.articleId)).toEqual([]);
  });

  it("义项判断失败时这一批算失败，不留下半截数据", async () => {
    await importArticle(
      db,
      scriptedAi({ extract: phraseExtractor(PHRASES) }),
      "I ran into an old friend at the airport.",
      [0],
    );
    const ai = scriptedAi({
      extract: phraseExtractor(PHRASES),
      sense: () => {
        throw new Error("sense failed");
      },
    });
    const second = await importArticle(
      db,
      ai,
      "She ran into her teacher. He made up his mind.",
      [0],
      2000,
    );
    expect(second.summary).toMatchObject({
      added: 0,
      merged: 0,
      failedBatches: 1,
      firstError: "sense failed",
    });
    const [row] = await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM chunks");
    expect(row?.n).toBe(1);
  });

  it("AI 返回格式不正确：重试一次后仍失败则该批失败", async () => {
    let calls = 0;
    const ai: AiClient = {
      async chat() {
        calls++;
        return "抱歉";
      },
    };
    const { summary } = await importArticle(db, ai, "I ran into an old friend.", [0]);
    expect(summary.failedBatches).toBe(1);
    expect(calls).toBe(2);
  });

  it("回调进度", async () => {
    const { articleId } = await createArticle(db, {
      title: "T",
      sourceType: "paste",
      sourceRef: null,
      text: ARTICLE_A,
      selectedParagraphs: new Set([0, 2]),
    });
    const progress: string[] = [];
    await runExtraction(db, scriptedAi({ extract: () => [] }), articleId, {
      onProgress: (done, total) => progress.push(`${done}/${total}`),
    });
    expect(progress).toEqual(["1/2", "2/2"]);
  });

  it("没有待处理批次时什么都不做", async () => {
    const ai = scriptedAi({ extract: () => [] });
    const { summary } = await importArticle(db, ai, ARTICLE_A, []);
    expect(summary.batches).toBe(0);
    expect(ai.extractCalls).toBe(0);
  });
});

describe("deleteArticle", () => {
  it("只属于这篇文章的句块一并删除，合并过的句块只删这篇的例句", async () => {
    const ai = scriptedAi({
      extract: phraseExtractor(PHRASES),
      sense: (c) => c.split("\n#").map(() => 1),
    });
    const a = await importArticle(
      db,
      ai,
      "I ran into an old friend. In the wake of the storm, we left.",
      [0],
      1000,
    );
    const b = await importArticle(
      db,
      ai,
      "She ran into her teacher. He made up his mind.",
      [0],
      2000,
    );
    // A 独有 in the wake of；run into 两篇共有；B 独有 make up one's mind
    expect(await countChunksOnlyIn(db, a.articleId)).toBe(1);
    expect(await countChunksOnlyIn(db, b.articleId)).toBe(1);

    await deleteArticle(db, a.articleId);
    const chunks = await db.query<{ lemma_key: string; n: number }>(
      "SELECT lemma_key, (SELECT COUNT(*) FROM examples e WHERE e.chunk_id = chunks.id) AS n FROM chunks ORDER BY lemma_key",
    );
    expect(chunks).toEqual([
      { lemma_key: "make up one's mind", n: 1 },
      { lemma_key: "run into", n: 1 },
    ]);
    const [left] = await db.query<{ articles: number; sentences: number; batches: number }>(
      "SELECT (SELECT COUNT(*) FROM articles) AS articles, (SELECT COUNT(*) FROM sentences) AS sentences, (SELECT COUNT(*) FROM extraction_batches) AS batches",
    );
    expect(left).toEqual({ articles: 1, sentences: 2, batches: 1 });
  });
});

describe("settings", () => {
  it("未设置时返回默认值", async () => {
    expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS);
  });

  it("保存后读回，非法值回退到默认", async () => {
    await saveSettings(db, { dailyNew: 35, theme: "dark", aiModel: "my-model" });
    await saveSettings(db, { dailyNew: 40 });
    expect(await getSettings(db)).toMatchObject({
      dailyNew: 40,
      theme: "dark",
      aiModel: "my-model",
    });
    await db.transaction([
      { sql: "UPDATE meta SET value = '0' WHERE key = 'daily_new'" },
      { sql: "UPDATE meta SET value = '  ' WHERE key = 'ai_model'" },
    ]);
    expect(await getSettings(db)).toMatchObject({
      dailyNew: 20,
      aiModel: DEFAULT_SETTINGS.aiModel,
    });
  });
});

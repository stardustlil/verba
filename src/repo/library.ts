/**
 * 文章库与句块库的查询，以及手动添加句块（需求 3.3 末段、第 7、8 节）。
 */
import { MAX_EXAMPLES } from "../core/extract/resolve";
import { lemmaKey } from "../core/judge/normalize";
import { MASTERED_INTERVAL_DAYS } from "../core/srs/scheduler";
import { type ChunkStatus, type Stage, chunkStatus } from "../core/srs/stage";
import { type SourceType, getArticle } from "./articles";
import { type Db, type SqlValue, type Statement, newId } from "./db";
import { MY_BOOK, inBookCondition } from "./books";
import { EXAMPLE_COLUMNS, type StudyExample } from "./study";

// ---------- 文章 ----------

export interface ArticleListItem {
  id: string;
  title: string;
  sourceType: SourceType;
  sourceRef: string | null;
  createdAt: number;
  chunkCount: number;
  /** 已学（已认识）的句块数 */
  learnedCount: number;
}

export async function listArticles(db: Db): Promise<ArticleListItem[]> {
  const rows = await db.query<{
    id: string;
    title: string;
    source_type: SourceType;
    source_ref: string | null;
    created_at: number;
    chunk_count: number;
    learned_count: number;
  }>(
    `SELECT a.id, a.title, a.source_type, a.source_ref, a.created_at,
       (SELECT COUNT(DISTINCT e.chunk_id) FROM examples e JOIN chunks c ON c.id = e.chunk_id
          WHERE e.article_id = a.id AND c.deleted_at IS NULL) AS chunk_count,
       (SELECT COUNT(DISTINCT e.chunk_id) FROM examples e JOIN chunks c ON c.id = e.chunk_id
          WHERE e.article_id = a.id AND c.deleted_at IS NULL AND c.stage != 'new') AS learned_count
     FROM articles a ORDER BY a.created_at DESC, a.id`,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    sourceType: r.source_type,
    sourceRef: r.source_ref,
    createdAt: r.created_at,
    chunkCount: r.chunk_count,
    learnedCount: r.learned_count,
  }));
}

export interface ArticleSentence {
  id: string;
  idx: number;
  paragraphIdx: number;
  text: string;
  start: number;
  end: number;
}

/** 文中的一处句块（一个例句），offset 为在全文中的位置 */
export interface ArticleHighlight {
  exampleId: string;
  chunkId: string;
  sentenceId: string;
  start: number;
  length: number;
  lemma: string;
  meaning: string;
  status: ChunkStatus;
}

export interface ArticleDetail {
  id: string;
  title: string;
  sourceType: SourceType;
  sourceRef: string | null;
  text: string;
  createdAt: number;
  sentences: ArticleSentence[];
  highlights: ArticleHighlight[];
  /** 尚未完成抽取的批次数（待处理或失败） */
  unfinishedBatches: number;
}

export async function articleDetail(db: Db, articleId: string): Promise<ArticleDetail | null> {
  const article = await getArticle(db, articleId);
  if (!article) return null;
  const sentences = await db.query<{
    id: string;
    idx: number;
    paragraph_idx: number;
    text: string;
    start_offset: number;
    end_offset: number;
  }>(
    "SELECT id, idx, paragraph_idx, text, start_offset, end_offset FROM sentences WHERE article_id = ? ORDER BY idx",
    [articleId],
  );
  const highlights = await db.query<{
    example_id: string;
    chunk_id: string;
    sentence_id: string;
    start: number;
    surface: string;
    lemma: string;
    meaning: string;
    stage: Stage;
    scheduled_days: number;
  }>(
    `SELECT e.id AS example_id, e.chunk_id, e.sentence_id,
            s.start_offset + e.start_in_sentence AS start, e.surface,
            c.lemma, c.meaning, c.stage, c.scheduled_days
     FROM examples e
     JOIN sentences s ON s.id = e.sentence_id
     JOIN chunks c ON c.id = e.chunk_id
     WHERE e.article_id = ? AND c.deleted_at IS NULL
     ORDER BY start`,
    [articleId],
  );
  const [batches] = await db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM extraction_batches WHERE article_id = ? AND status != 'done'",
    [articleId],
  );
  return {
    ...article,
    sentences: sentences.map((s) => ({
      id: s.id,
      idx: s.idx,
      paragraphIdx: s.paragraph_idx,
      text: s.text,
      start: s.start_offset,
      end: s.end_offset,
    })),
    highlights: highlights.map((h) => ({
      exampleId: h.example_id,
      chunkId: h.chunk_id,
      sentenceId: h.sentence_id,
      start: h.start,
      // 偏移按 JavaScript 字符串计，长度也在这里算，不用 SQLite 的 LENGTH
      length: h.surface.length,
      lemma: h.lemma,
      meaning: h.meaning,
      status: chunkStatus(h.stage, h.scheduled_days),
    })),
    unfinishedBatches: batches?.n ?? 0,
  };
}

// ---------- 手动添加句块 ----------

/** 库中原形相同的句块（义项），手动添加时用来让用户选择合并还是新建 */
export interface SameLemmaChunk {
  id: string;
  lemma: string;
  meaning: string;
  exampleCount: number;
}

export async function chunksWithLemma(db: Db, lemma: string): Promise<SameLemmaChunk[]> {
  const rows = await db.query<{ id: string; lemma: string; meaning: string; n: number }>(
    `SELECT c.id, c.lemma, c.meaning, (SELECT COUNT(*) FROM examples e WHERE e.chunk_id = c.id) AS n
     FROM chunks c WHERE c.deleted_at IS NULL AND c.lemma_key = ? ORDER BY c.created_at, c.id`,
    [lemmaKey(lemma)],
  );
  return rows.map((r) => ({ id: r.id, lemma: r.lemma, meaning: r.meaning, exampleCount: r.n }));
}

export interface ManualChunkInput {
  articleId: string;
  sentenceId: string;
  /** 选中的文字，即原文形式 */
  surface: string;
  /** 原文形式在句中的位置 */
  startInSentence: number;
  lemma: string;
  meaning: string;
  /** 合并到这个已有句块作为例句；不填则新建 */
  mergeInto?: string;
  now?: number;
}

/**
 * 手动添加句块：选中的文字作为原文形式，原形和中文释义由用户填写。
 * 手动添加不受忽略名单限制。
 */
export async function addManualChunk(
  db: Db,
  input: ManualChunkInput,
): Promise<{ chunkId: string; merged: boolean }> {
  const now = input.now ?? Date.now();
  const lemma = input.lemma.trim().replace(/\s+/g, " ");
  const meaning = input.meaning.trim();
  const surface = input.surface;
  if (!surface.trim()) throw new Error("请先在文中选中文字");
  if (!lemma) throw new Error("请填写原形");
  if (!meaning && !input.mergeInto) throw new Error("请填写中文释义");

  const [sentence] = await db.query<{ idx: number; text: string }>(
    "SELECT idx, text FROM sentences WHERE id = ? AND article_id = ?",
    [input.sentenceId, input.articleId],
  );
  if (!sentence) throw new Error("句子不存在");
  if (
    sentence.text.slice(input.startInSentence, input.startInSentence + surface.length) !== surface
  )
    throw new Error("选中的文字与原句不一致");

  const example: Statement = {
    sql: `INSERT INTO examples (id, chunk_id, sentence_id, article_id, sentence_text, surface, start_in_sentence, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [] as SqlValue[],
  };

  if (input.mergeInto) {
    const chunkId = input.mergeInto;
    const [count] = await db.query<{ n: number; same: number }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(sentence_id = ?), 0) AS same FROM examples WHERE chunk_id = ?`,
      [input.sentenceId, chunkId],
    );
    if ((count?.same ?? 0) > 0) throw new Error("这个句子已经是该句块的例句");
    if ((count?.n ?? 0) >= MAX_EXAMPLES)
      throw new Error(`该句块已有 ${MAX_EXAMPLES} 个例句，不能再添加`);
    example.params = [
      newId(),
      chunkId,
      input.sentenceId,
      input.articleId,
      sentence.text,
      surface,
      input.startInSentence,
      now,
    ];
    await db.transaction([example]);
    return { chunkId, merged: true };
  }

  const article = await getArticle(db, input.articleId);
  if (!article) throw new Error("文章不存在");
  const chunkId = newId();
  example.params = [
    newId(),
    chunkId,
    input.sentenceId,
    input.articleId,
    sentence.text,
    surface,
    input.startInSentence,
    now,
  ];
  await db.transaction([
    {
      sql: `INSERT INTO chunks (id, lemma, lemma_key, meaning, origin, created_at, sort_time, sort_sentence, sort_offset)
            VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?)`,
      params: [
        chunkId,
        lemma,
        lemmaKey(lemma),
        meaning,
        now,
        article.createdAt,
        sentence.idx,
        input.startInSentence,
      ],
    },
    example,
  ]);
  return { chunkId, merged: false };
}

// ---------- 句块 ----------

/** book：按书中顺序（需同时指定内置词书） */
export type ChunkSort = "added" | "due" | "errors" | "book";

export interface ChunkFilter {
  search?: string;
  status?: ChunkStatus | "all";
  articleId?: string | null;
  /** 词书编号，或 MY_BOOK */
  bookId?: string | null;
  sort?: ChunkSort;
}

export interface ChunkListItem {
  id: string;
  lemma: string;
  meaning: string;
  status: ChunkStatus;
  due: number | null;
  createdAt: number;
  errors: number;
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const STATUS_CONDITION: Record<ChunkStatus, string> = {
  new: "c.stage = 'new'",
  learning: `c.stage != 'new' AND c.scheduled_days < ${MASTERED_INTERVAL_DAYS}`,
  mastered: `c.stage != 'new' AND c.scheduled_days >= ${MASTERED_INTERVAL_DAYS}`,
};

const ORDER_BY: Record<Exclude<ChunkSort, "book">, string> = {
  added: "c.created_at DESC, c.sort_time DESC, c.sort_sentence, c.sort_offset",
  // 新句块没有复习时间，排在最后；认识后还没做第一次填空的排在最前
  due: "c.stage = 'new', c.due IS NOT NULL, c.due, c.sort_time, c.sort_sentence, c.sort_offset",
  errors: "errors DESC, c.created_at DESC",
};

export async function listChunks(db: Db, filter: ChunkFilter = {}): Promise<ChunkListItem[]> {
  const where = ["c.deleted_at IS NULL"];
  const params: SqlValue[] = [];
  const search = filter.search?.trim();
  if (search) {
    const pattern = likePattern(search);
    where.push(
      `(c.lemma LIKE ? ESCAPE '\\' OR c.meaning LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM alt_answers a WHERE a.chunk_id = c.id AND a.text LIKE ? ESCAPE '\\'))`,
    );
    params.push(pattern, pattern, pattern);
  }
  if (filter.status && filter.status !== "all") where.push(STATUS_CONDITION[filter.status]);
  if (filter.bookId) {
    const condition = inBookCondition(filter.bookId);
    where.push(condition.sql);
    params.push(...condition.params);
  }
  if (filter.articleId) {
    where.push("EXISTS (SELECT 1 FROM examples e WHERE e.chunk_id = c.id AND e.article_id = ?)");
    params.push(filter.articleId);
  }
  let order = ORDER_BY.added;
  const orderParams: SqlValue[] = [];
  if (filter.sort === "book" && filter.bookId && filter.bookId !== MY_BOOK) {
    order = "(SELECT bc.idx FROM book_chunks bc WHERE bc.chunk_id = c.id AND bc.book_id = ?)";
    orderParams.push(filter.bookId);
  } else if (filter.sort && filter.sort !== "book") {
    order = ORDER_BY[filter.sort];
  }
  const rows = await db.query<{
    id: string;
    lemma: string;
    meaning: string;
    stage: Stage;
    scheduled_days: number;
    due: number | null;
    created_at: number;
    errors: number;
  }>(
    `SELECT c.id, c.lemma, c.meaning, c.stage, c.scheduled_days, c.due, c.created_at,
       (SELECT COUNT(*) FROM reviews r WHERE r.chunk_id = c.id AND r.rating = 'again') AS errors
     FROM chunks c WHERE ${where.join(" AND ")}
     ORDER BY ${order}, c.id`,
    [...params, ...orderParams],
  );
  return rows.map((r) => ({
    id: r.id,
    lemma: r.lemma,
    meaning: r.meaning,
    status: chunkStatus(r.stage, r.scheduled_days),
    due: r.stage === "new" ? null : r.due,
    createdAt: r.created_at,
    errors: r.errors,
  }));
}

export interface ChunkDetail {
  id: string;
  lemma: string;
  meaning: string;
  origin: "ai" | "manual" | "book";
  status: ChunkStatus;
  stage: Stage;
  due: number | null;
  scheduledDays: number;
  createdAt: number;
  examples: StudyExample[];
  altAnswers: Array<{ id: string; text: string }>;
  reviews: Array<{
    id: string;
    answeredAt: number;
    mode: "cloze" | "recall";
    input: string;
    rating: "good" | "hard" | "again";
    counted: boolean;
    viewedAnswer: boolean;
    overridden: boolean;
  }>;
}

export async function chunkDetail(db: Db, chunkId: string): Promise<ChunkDetail | null> {
  const [c] = await db.query<{
    id: string;
    lemma: string;
    meaning: string;
    origin: "ai" | "manual" | "book";
    stage: Stage;
    due: number | null;
    scheduled_days: number;
    created_at: number;
  }>(
    `SELECT id, lemma, meaning, origin, stage, due, scheduled_days, created_at
     FROM chunks WHERE id = ? AND deleted_at IS NULL`,
    [chunkId],
  );
  if (!c) return null;
  const examples = await db.query<{
    id: string;
    sentence: string;
    surface: string;
    start: number;
    translation: string | null;
    article_id: string | null;
    title: string | null;
  }>(
    `SELECT ${EXAMPLE_COLUMNS}
     FROM examples e
     LEFT JOIN articles a ON a.id = e.article_id
     LEFT JOIN books b ON b.id = e.book_id
     WHERE e.chunk_id = ? ORDER BY e.created_at, e.id`,
    [chunkId],
  );
  const alts = await db.query<{ id: string; text: string }>(
    "SELECT id, text FROM alt_answers WHERE chunk_id = ? ORDER BY created_at, id",
    [chunkId],
  );
  const reviews = await db.query<{
    id: string;
    answered_at: number;
    mode: "cloze" | "recall";
    input: string;
    rating: "good" | "hard" | "again";
    counted: number;
    viewed_answer: number;
    overridden: number;
  }>(
    `SELECT id, answered_at, mode, input, rating, counted, viewed_answer, overridden
     FROM reviews WHERE chunk_id = ? ORDER BY answered_at DESC, rowid DESC`,
    [chunkId],
  );
  return {
    id: c.id,
    lemma: c.lemma,
    meaning: c.meaning,
    origin: c.origin,
    status: chunkStatus(c.stage, c.scheduled_days),
    stage: c.stage,
    due: c.due,
    scheduledDays: c.scheduled_days,
    createdAt: c.created_at,
    examples: examples.map((e) => ({
      id: e.id,
      sentence: e.sentence,
      surface: e.surface,
      start: e.start,
      translation: e.translation,
      articleId: e.article_id,
      sourceTitle: e.title ?? "",
    })),
    altAnswers: alts,
    reviews: reviews.map((r) => ({
      id: r.id,
      answeredAt: r.answered_at,
      mode: r.mode,
      input: r.input,
      rating: r.rating,
      counted: r.counted === 1,
      viewedAnswer: r.viewed_answer === 1,
      overridden: r.overridden === 1,
    })),
  };
}

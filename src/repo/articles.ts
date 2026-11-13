/** 文章的读写（需求第 2、7 节） */
import { makeBatches } from "../core/extract/pipeline";
import type { SourceSentence } from "../core/extract/types";
import { segmentSentences, splitParagraphs } from "../core/text/segment";
import { type Db, type Statement, newId } from "./db";

export type SourceType = "paste" | "url" | "file";

export interface NewArticle {
  title: string;
  sourceType: SourceType;
  /** 网址或文件名；粘贴的文本为 null */
  sourceRef: string | null;
  /** 规范形式的正文：空行分段，段内无换行 */
  text: string;
  /** 要抽取句块的段落编号 */
  selectedParagraphs: ReadonlySet<number>;
}

export interface Article {
  id: string;
  title: string;
  sourceType: SourceType;
  sourceRef: string | null;
  text: string;
  createdAt: number;
}

export interface StoredSentence extends SourceSentence {
  id: string;
}

export interface PendingBatch {
  id: string;
  status: "pending" | "failed";
  sentences: StoredSentence[];
}

/**
 * 保存文章，切分句子，并为选中的段落建好待抽取的批次。
 * 抽取本身由 importer 执行；没有配置 AI 时文章照样保存，批次保持待处理。
 */
export async function createArticle(
  db: Db,
  input: NewArticle,
  now: number = Date.now(),
): Promise<{ articleId: string; batchCount: number }> {
  const articleId = newId();
  const sentences = segmentSentences(input.text);
  const statements: Statement[] = [
    {
      sql: "INSERT INTO articles (id, title, source_type, source_ref, text, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      params: [articleId, input.title, input.sourceType, input.sourceRef, input.text, now],
    },
  ];
  for (const s of sentences) {
    statements.push({
      sql: "INSERT INTO sentences (id, article_id, idx, paragraph_idx, text, start_offset, end_offset, selected) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      params: [
        newId(),
        articleId,
        s.idx,
        s.paragraphIdx,
        s.text,
        s.start,
        s.end,
        input.selectedParagraphs.has(s.paragraphIdx) ? 1 : 0,
      ],
    });
  }
  const batches = makeBatches(
    sentences.filter((s) => input.selectedParagraphs.has(s.paragraphIdx)),
  );
  for (const batch of batches) {
    const first = batch[0];
    const last = batch.at(-1);
    if (!first || !last) continue;
    statements.push({
      sql: "INSERT INTO extraction_batches (id, article_id, sentence_from, sentence_to, status, updated_at) VALUES (?, ?, ?, ?, 'pending', ?)",
      params: [newId(), articleId, first.idx, last.idx, now],
    });
  }
  await db.transaction(statements);
  return { articleId, batchCount: batches.length };
}

interface ArticleRow {
  id: string;
  title: string;
  source_type: SourceType;
  source_ref: string | null;
  text: string;
  created_at: number;
}

export async function getArticle(db: Db, articleId: string): Promise<Article | null> {
  const [row] = await db.query<ArticleRow>("SELECT * FROM articles WHERE id = ?", [articleId]);
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    text: row.text,
    createdAt: row.created_at,
  };
}

/** 尚未完成抽取的批次（待处理或上次失败），连同各自的句子 */
export async function pendingBatches(db: Db, articleId: string): Promise<PendingBatch[]> {
  const batches = await db.query<{
    id: string;
    status: "pending" | "failed";
    sentence_from: number;
    sentence_to: number;
  }>(
    "SELECT id, status, sentence_from, sentence_to FROM extraction_batches WHERE article_id = ? AND status != 'done' ORDER BY sentence_from",
    [articleId],
  );
  if (batches.length === 0) return [];
  const sentences = await db.query<{
    id: string;
    idx: number;
    paragraph_idx: number;
    text: string;
  }>("SELECT id, idx, paragraph_idx, text FROM sentences WHERE article_id = ? ORDER BY idx", [
    articleId,
  ]);
  return batches.map((batch) => ({
    id: batch.id,
    status: batch.status,
    sentences: sentences
      .filter((s) => s.idx >= batch.sentence_from && s.idx <= batch.sentence_to)
      .map((s) => ({ id: s.id, idx: s.idx, paragraphIdx: s.paragraph_idx, text: s.text })),
  }));
}

/** 删除文章时会一并删除的句块数：只属于这篇文章的句块（需求 7.3） */
export async function countChunksOnlyIn(db: Db, articleId: string): Promise<number> {
  const [row] = await db.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM chunks c
     WHERE c.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM examples e WHERE e.chunk_id = c.id AND e.article_id = ?)
       AND NOT EXISTS (SELECT 1 FROM examples e WHERE e.chunk_id = c.id AND e.article_id != ?)`,
    [articleId, articleId],
  );
  return row?.n ?? 0;
}

/**
 * 删除文章（需求 7.3）：只属于这篇文章的句块一并删除；
 * 与其他文章合并过的句块保留，只删除来自这篇文章的例句。
 */
export async function deleteArticle(db: Db, articleId: string): Promise<void> {
  await db.transaction([
    {
      sql: `DELETE FROM chunks
            WHERE EXISTS (SELECT 1 FROM examples e WHERE e.chunk_id = chunks.id AND e.article_id = ?)
              AND NOT EXISTS (SELECT 1 FROM examples e WHERE e.chunk_id = chunks.id AND e.article_id != ?)`,
      params: [articleId, articleId],
    },
    // 句子、例句、抽取批次随文章级联删除
    { sql: "DELETE FROM articles WHERE id = ?", params: [articleId] },
  ]);
}

/** 预览时用：把正文按段落切开 */
export function paragraphsOf(text: string): string[] {
  return splitParagraphs(text).map((p) => p.text);
}

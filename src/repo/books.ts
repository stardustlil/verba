/**
 * 词书：内置的短语书，以及“我的句块”（从文章里抽取或手动添加的句块）。
 * 新句块从当前词书里按顺序取；到期复习不分书。
 */
import { lemmaKey } from "../core/judge/normalize";
import { MAX_EXAMPLES } from "../core/extract/resolve";
import { locateSurface } from "../core/extract/validate";
import { type Db, type Statement, newId, placeholders } from "./db";
import { ignoredKeys } from "./chunks";

/** “我的句块”这本虚拟书的编号 */
export const MY_BOOK = "mine";

export interface BookEntry {
  lemma: string;
  /** 例句中的原文形式 */
  surface: string;
  meaning: string;
  example: string;
  translation: string;
}

export interface BookData {
  id: string;
  title: string;
  description: string;
  color: string;
  /** 内容有改动时加一，启动时据此补写新条目 */
  version: number;
  entries: BookEntry[];
}

export interface BookSummary {
  id: string;
  title: string;
  description: string;
  color: string;
  builtin: boolean;
  total: number;
  /** 已开始学习（不再是“新”）的句块数 */
  learned: number;
  /** 尚未学习的句块数 */
  fresh: number;
}

const versionKey = (bookId: string) => `book_version:${bookId}`;

/** 内置词书里一个条目对应的句块编号：按原形生成，内容顺序调整后也不变 */
export function bookChunkId(bookId: string, lemma: string): string {
  return `book:${bookId}:${lemmaKey(lemma)}`;
}

/**
 * 把内置词书写进数据库。每本书只在版本变化时处理一次：
 * 只新增尚未在书中的条目；原形在忽略名单里的跳过（用户删过的不会复活）；
 * 库里已有同原形的句块时直接挂到书上，并补上书里的例句。
 */
export async function seedBuiltinBooks(
  db: Db,
  books: readonly BookData[],
  now: number = Date.now(),
): Promise<void> {
  const meta = await db.query<{ key: string; value: string }>(
    "SELECT key, value FROM meta WHERE key LIKE 'book_version:%'",
  );
  const versions = new Map(meta.map((m) => [m.key, Number(m.value)]));
  const pending = books.filter((b) => versions.get(versionKey(b.id)) !== b.version);
  if (pending.length === 0) return;
  const ignored = await ignoredKeys(db);

  for (const [sort, book] of books.entries()) {
    if (!pending.includes(book)) continue;
    const keys = book.entries.map((e) => lemmaKey(e.lemma));
    const existing = await db.query<{ id: string; lemma_key: string; examples: number }>(
      `SELECT c.id, c.lemma_key, (SELECT COUNT(*) FROM examples e WHERE e.chunk_id = c.id) AS examples
       FROM chunks c WHERE c.deleted_at IS NULL AND c.lemma_key IN (${placeholders(keys.length)})
       ORDER BY c.created_at, c.id`,
      keys,
    );
    const byKey = new Map<string, { id: string; examples: number }>();
    for (const row of existing) if (!byKey.has(row.lemma_key)) byKey.set(row.lemma_key, row);
    const sentences = await db.query<{ chunk_id: string; sentence_text: string }>(
      `SELECT chunk_id, sentence_text FROM examples
       WHERE chunk_id IN (${placeholders(Math.max(existing.length, 1))})`,
      existing.length > 0 ? existing.map((r) => r.id) : [""],
    );
    const hasSentence = new Set(sentences.map((s) => `${s.chunk_id}\n${s.sentence_text}`));

    const statements: Statement[] = [
      {
        sql: `INSERT INTO books (id, title, description, builtin, sort, color, created_at)
              VALUES (?, ?, ?, 1, ?, ?, ?)
              ON CONFLICT (id) DO UPDATE SET title = excluded.title, description = excluded.description,
                sort = excluded.sort, color = excluded.color`,
        params: [book.id, book.title, book.description, sort, book.color, now],
      },
    ];
    for (const [idx, entry] of book.entries.entries()) {
      const key = lemmaKey(entry.lemma);
      if (ignored.has(key)) continue;
      const position = locateSurface(entry.example, entry.surface);
      const found = byKey.get(key);
      const chunkId = found?.id ?? bookChunkId(book.id, entry.lemma);
      if (!found) {
        statements.push({
          sql: `INSERT OR IGNORE INTO chunks (id, lemma, lemma_key, meaning, origin, created_at, sort_time, sort_sentence, sort_offset)
                VALUES (?, ?, ?, ?, 'book', ?, 0, ?, 0)`,
          params: [chunkId, entry.lemma, key, entry.meaning, now, idx],
        });
        byKey.set(key, { id: chunkId, examples: 0 });
      }
      const target = byKey.get(key)!;
      if (
        position &&
        target.examples < MAX_EXAMPLES &&
        !hasSentence.has(`${chunkId}\n${entry.example}`)
      ) {
        statements.push({
          sql: `INSERT INTO examples (id, chunk_id, book_id, sentence_text, translation, surface, start_in_sentence, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            newId(),
            chunkId,
            book.id,
            entry.example,
            entry.translation,
            entry.example.slice(position.start, position.end),
            position.start,
            now,
          ],
        });
        target.examples++;
        hasSentence.add(`${chunkId}\n${entry.example}`);
      }
      statements.push({
        sql: `INSERT INTO book_chunks (book_id, chunk_id, idx) VALUES (?, ?, ?)
              ON CONFLICT (book_id, chunk_id) DO UPDATE SET idx = excluded.idx`,
        params: [book.id, chunkId, idx],
      });
    }
    statements.push({
      sql: "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      params: [versionKey(book.id), String(book.version)],
    });
    await db.transaction(statements);
  }
}

/** 有文章例句的句块，即“我的句块” */
const IN_MY_BOOK =
  "EXISTS (SELECT 1 FROM examples e WHERE e.chunk_id = c.id AND e.article_id IS NOT NULL)";

/** 全部词书，内置书在前，最后是“我的句块” */
export async function listBooks(db: Db): Promise<BookSummary[]> {
  const rows = await db.query<{
    id: string;
    title: string;
    description: string;
    color: string;
    total: number;
    learned: number | null;
  }>(
    `SELECT b.id, b.title, b.description, b.color, COUNT(c.id) AS total,
            SUM(c.stage != 'new') AS learned
     FROM books b
     LEFT JOIN book_chunks bc ON bc.book_id = b.id
     LEFT JOIN chunks c ON c.id = bc.chunk_id AND c.deleted_at IS NULL
     GROUP BY b.id ORDER BY b.sort, b.created_at`,
  );
  const [mine] = await db.query<{ total: number; learned: number | null }>(
    `SELECT COUNT(*) AS total, SUM(c.stage != 'new') AS learned
     FROM chunks c WHERE c.deleted_at IS NULL AND ${IN_MY_BOOK}`,
  );
  const books: BookSummary[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    color: r.color,
    builtin: true,
    total: r.total,
    learned: r.learned ?? 0,
    fresh: r.total - (r.learned ?? 0),
  }));
  const total = mine?.total ?? 0;
  const learned = mine?.learned ?? 0;
  books.push({
    id: MY_BOOK,
    title: "我的句块",
    description: "从导入的文章中抽取或手动添加的句块。",
    color: "slate",
    builtin: false,
    total,
    learned,
    fresh: total - learned,
  });
  return books;
}

/** 当前词书；未设置或已不存在时取第一本 */
export async function currentBookId(db: Db): Promise<string> {
  const [row] = await db.query<{ value: string }>(
    "SELECT value FROM meta WHERE key = 'current_book'",
  );
  if (row?.value === MY_BOOK) return MY_BOOK;
  if (row) {
    const [book] = await db.query<{ id: string }>("SELECT id FROM books WHERE id = ?", [row.value]);
    if (book) return book.id;
  }
  const [first] = await db.query<{ id: string }>(
    "SELECT id FROM books ORDER BY sort, created_at LIMIT 1",
  );
  return first?.id ?? MY_BOOK;
}

export async function setCurrentBook(db: Db, bookId: string): Promise<void> {
  await db.transaction([
    {
      sql: "INSERT INTO meta (key, value) VALUES ('current_book', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      params: [bookId],
    },
  ]);
}

/** 某本书里接下来要学的新句块，按书中顺序 */
export async function nextNewChunks(db: Db, bookId: string, limit: number): Promise<string[]> {
  if (limit <= 0) return [];
  const rows =
    bookId === MY_BOOK
      ? await db.query<{ id: string }>(
          `SELECT c.id FROM chunks c
           WHERE c.deleted_at IS NULL AND c.stage = 'new' AND ${IN_MY_BOOK}
           ORDER BY c.sort_time, c.sort_sentence, c.sort_offset, c.created_at, c.id LIMIT ?`,
          [limit],
        )
      : await db.query<{ id: string }>(
          `SELECT c.id FROM book_chunks bc JOIN chunks c ON c.id = bc.chunk_id
           WHERE bc.book_id = ? AND c.deleted_at IS NULL AND c.stage = 'new'
           ORDER BY bc.idx LIMIT ?`,
          [bookId, limit],
        );
  return rows.map((r) => r.id);
}

/** 某本书里还没学的句块数 */
export async function freshCount(db: Db, bookId: string): Promise<number> {
  const [row] =
    bookId === MY_BOOK
      ? await db.query<{ n: number }>(
          `SELECT COUNT(*) AS n FROM chunks c
           WHERE c.deleted_at IS NULL AND c.stage = 'new' AND ${IN_MY_BOOK}`,
        )
      : await db.query<{ n: number }>(
          `SELECT COUNT(*) AS n FROM book_chunks bc JOIN chunks c ON c.id = bc.chunk_id
           WHERE bc.book_id = ? AND c.deleted_at IS NULL AND c.stage = 'new'`,
          [bookId],
        );
  return row?.n ?? 0;
}

/** 句块列表按书筛选用的条件；参数为书的编号（“我的句块”不需要参数） */
export function inBookCondition(bookId: string): { sql: string; params: string[] } {
  if (bookId === MY_BOOK) return { sql: IN_MY_BOOK, params: [] };
  return {
    sql: "EXISTS (SELECT 1 FROM book_chunks bc WHERE bc.chunk_id = c.id AND bc.book_id = ?)",
    params: [bookId],
  };
}

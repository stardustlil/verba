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
  /** 例句在 Tatoeba 中的编号；没有的是新写的例句 */
  tatoeba?: number;
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

/** 每个库上正在进行（或最近一次）的词书写入，后来的排在它后面 */
const seeding = new WeakMap<Db, Promise<void>>();

/**
 * 把内置词书写进数据库。每本书只在版本变化时处理一次：
 * - 新增尚未在书中的条目；原形在忽略名单里的跳过（用户删过的不会复活）；
 *   库里已有同原形的句块时直接挂到书上，并补上书里的例句
 * - 还没学过的条目，释义和书里的例句换成新版
 * - 新版里去掉的条目：没学过的直接删除（别的书还收录的只解除关联）；
 *   学过的保留在书末，复习进度不受影响
 */
export function seedBuiltinBooks(
  db: Db,
  books: readonly BookData[],
  now: number = Date.now(),
): Promise<void> {
  // 同一个库上的写入排队执行。两次写入同时进行时，后一次读到的还是写入前的状态，
  // 会把每个例句再插一遍（开发模式下 React 会把启动流程执行两遍，正好触发）。
  const previous = seeding.get(db) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => seedBooks(db, books, now));
  seeding.set(db, next);
  return next;
}

async function seedBooks(db: Db, books: readonly BookData[], now: number): Promise<void> {
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
    const bookKeys = new Set(keys);
    const otherKeys = new Set(
      books.filter((b) => b !== book).flatMap((b) => b.entries.map((e) => lemmaKey(e.lemma))),
    );
    const existing = await db.query<{
      id: string;
      lemma_key: string;
      stage: string;
      origin: string;
      examples: number;
    }>(
      `SELECT c.id, c.lemma_key, c.stage, c.origin,
              (SELECT COUNT(*) FROM examples e WHERE e.chunk_id = c.id) AS examples
       FROM chunks c WHERE c.deleted_at IS NULL AND c.lemma_key IN (${placeholders(keys.length)})
       ORDER BY c.created_at, c.id`,
      keys,
    );
    const byKey = new Map<string, { id: string; examples: number; fresh: boolean }>();
    for (const row of existing) {
      if (byKey.has(row.lemma_key)) continue;
      byKey.set(row.lemma_key, {
        id: row.id,
        examples: row.examples,
        // 还没学过、也不是用户自己添加的：可以整体换成新版内容
        fresh: row.stage === "new" && row.origin === "book",
      });
    }
    const sentences = await db.query<{ chunk_id: string; sentence_text: string; book_id: string }>(
      `SELECT chunk_id, sentence_text, book_id FROM examples
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

    // 新版里去掉的条目
    const linked = await db.query<{
      chunk_id: string;
      lemma_key: string;
      stage: string;
      origin: string;
      from_article: number;
    }>(
      `SELECT c.id AS chunk_id, c.lemma_key, c.stage, c.origin,
              EXISTS (SELECT 1 FROM examples e WHERE e.chunk_id = c.id AND e.article_id IS NOT NULL) AS from_article
       FROM book_chunks bc JOIN chunks c ON c.id = bc.chunk_id
       WHERE bc.book_id = ? AND c.deleted_at IS NULL ORDER BY bc.idx`,
      [book.id],
    );
    let tail = book.entries.length;
    for (const row of linked) {
      if (bookKeys.has(row.lemma_key)) continue;
      const unstudied = row.stage === "new";
      if (
        unstudied &&
        row.origin === "book" &&
        !row.from_article &&
        !otherKeys.has(row.lemma_key)
      ) {
        statements.push(
          { sql: "DELETE FROM examples WHERE chunk_id = ?", params: [row.chunk_id] },
          { sql: "DELETE FROM book_chunks WHERE chunk_id = ?", params: [row.chunk_id] },
          { sql: "DELETE FROM chunks WHERE id = ?", params: [row.chunk_id] },
        );
      } else if (unstudied) {
        statements.push(
          {
            sql: "DELETE FROM examples WHERE chunk_id = ? AND book_id = ?",
            params: [row.chunk_id, book.id],
          },
          {
            sql: "DELETE FROM book_chunks WHERE book_id = ? AND chunk_id = ?",
            params: [book.id, row.chunk_id],
          },
        );
      } else {
        statements.push({
          sql: "UPDATE book_chunks SET idx = ? WHERE book_id = ? AND chunk_id = ?",
          params: [tail++, book.id, row.chunk_id],
        });
      }
    }

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
        byKey.set(key, { id: chunkId, examples: 0, fresh: true });
      } else if (found.fresh) {
        // 没学过的条目换成新版的原形写法、释义和例句
        const stale = sentences.filter(
          (s) =>
            s.chunk_id === chunkId && s.book_id === book.id && s.sentence_text !== entry.example,
        );
        statements.push({
          sql: "UPDATE chunks SET lemma = ?, meaning = ? WHERE id = ?",
          params: [entry.lemma, entry.meaning, chunkId],
        });
        if (stale.length > 0) {
          statements.push({
            sql: "DELETE FROM examples WHERE chunk_id = ? AND book_id = ? AND sentence_text != ?",
            params: [chunkId, book.id, entry.example],
          });
          found.examples -= stale.length;
          for (const s of stale) hasSentence.delete(`${s.chunk_id}\n${s.sentence_text}`);
        }
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
    title: "我的短语",
    description: "从导入的文章中抽取或手动添加的短语。",
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

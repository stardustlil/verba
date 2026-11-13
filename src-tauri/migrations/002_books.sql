-- 内置词书与例句翻译。
-- 本迁移重建了 chunks 与 examples 两张表（SQLite 不能修改 CHECK 与 NOT NULL 约束）。
-- 执行时外键检查是关闭的（见 db.rs 的 migrate），提交前会做一次 foreign_key_check。

CREATE TABLE books (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  builtin     INTEGER NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 0,
  -- 封面色：界面用的色名，如 violet / amber
  color       TEXT NOT NULL DEFAULT 'violet',
  created_at  INTEGER NOT NULL
);

-- 句块属于哪些书。同一个句块可以出现在多本书里；idx 为书内顺序（从 0 开始）
CREATE TABLE book_chunks (
  book_id  TEXT NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  chunk_id TEXT NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
  idx      INTEGER NOT NULL,
  PRIMARY KEY (book_id, chunk_id)
);

-- chunks：origin 加上 'book'
CREATE TABLE chunks_new (
  id             TEXT PRIMARY KEY,
  lemma          TEXT NOT NULL,
  lemma_key      TEXT NOT NULL,
  meaning        TEXT NOT NULL,
  origin         TEXT NOT NULL CHECK (origin IN ('ai', 'manual', 'book')),
  created_at     INTEGER NOT NULL,
  sort_time      INTEGER NOT NULL,
  sort_sentence  INTEGER NOT NULL,
  sort_offset    INTEGER NOT NULL,
  stage          TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'cloze', 'recall')),
  cloze_streak   INTEGER NOT NULL DEFAULT 0,
  example_cursor INTEGER NOT NULL DEFAULT 0,
  introduced_at  INTEGER,
  introduced_day TEXT,
  due            INTEGER,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  fsrs_card      TEXT,
  deleted_at     INTEGER
);
INSERT INTO chunks_new SELECT
  id, lemma, lemma_key, meaning, origin, created_at, sort_time, sort_sentence, sort_offset,
  stage, cloze_streak, example_cursor, introduced_at, introduced_day, due, scheduled_days,
  fsrs_card, deleted_at
FROM chunks;
DROP TABLE chunks;
ALTER TABLE chunks_new RENAME TO chunks;
CREATE INDEX idx_chunks_lemma_key ON chunks (lemma_key);
CREATE INDEX idx_chunks_due ON chunks (due);

-- examples：例句不一定来自文章（词书里的例句），原句与翻译直接存在例句上
CREATE TABLE examples_new (
  id                TEXT PRIMARY KEY,
  chunk_id          TEXT NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
  sentence_id       TEXT REFERENCES sentences (id) ON DELETE CASCADE,
  article_id        TEXT REFERENCES articles (id) ON DELETE CASCADE,
  -- 来自词书的例句：所属的书（与 article_id 二选一）
  book_id           TEXT REFERENCES books (id) ON DELETE CASCADE,
  sentence_text     TEXT NOT NULL,
  translation       TEXT,
  surface           TEXT NOT NULL,
  start_in_sentence INTEGER NOT NULL,
  created_at        INTEGER NOT NULL,
  UNIQUE (chunk_id, sentence_id)
);
INSERT INTO examples_new
  (id, chunk_id, sentence_id, article_id, sentence_text, translation, surface, start_in_sentence, created_at)
SELECT e.id, e.chunk_id, e.sentence_id, e.article_id, s.text, NULL, e.surface, e.start_in_sentence, e.created_at
FROM examples e JOIN sentences s ON s.id = e.sentence_id;
DROP TABLE examples;
ALTER TABLE examples_new RENAME TO examples;
CREATE INDEX idx_examples_chunk ON examples (chunk_id);
CREATE INDEX idx_examples_article ON examples (article_id);

CREATE INDEX idx_book_chunks_chunk ON book_chunks (chunk_id);
CREATE INDEX idx_book_chunks_order ON book_chunks (book_id, idx);

-- 当天的学习时长（毫秒）
ALTER TABLE days ADD COLUMN study_ms INTEGER NOT NULL DEFAULT 0;

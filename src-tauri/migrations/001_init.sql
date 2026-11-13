-- Verba 初始数据结构。
-- 时间一律为毫秒时间戳；学习日为 'YYYY-MM-DD'（凌晨 4 点分界，由前端计算）。
-- 文本偏移均为 UTF-16 码元下标（与 JavaScript 字符串一致）。

CREATE TABLE articles (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('paste', 'url', 'file')),
  source_ref  TEXT,
  text        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE sentences (
  id            TEXT PRIMARY KEY,
  article_id    TEXT NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  idx           INTEGER NOT NULL,
  paragraph_idx INTEGER NOT NULL,
  text          TEXT NOT NULL,
  start_offset  INTEGER NOT NULL,
  end_offset    INTEGER NOT NULL,
  selected      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (article_id, idx)
);

-- 抽取批次：用于“重试失败部分”。sentence_to 为闭区间。
CREATE TABLE extraction_batches (
  id            TEXT PRIMARY KEY,
  article_id    TEXT NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  sentence_from INTEGER NOT NULL,
  sentence_to   INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'done', 'failed')),
  error         TEXT,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE chunks (
  id             TEXT PRIMARY KEY,
  lemma          TEXT NOT NULL,
  lemma_key      TEXT NOT NULL,
  meaning        TEXT NOT NULL,
  origin         TEXT NOT NULL CHECK (origin IN ('ai', 'manual')),
  created_at     INTEGER NOT NULL,
  -- 新句块的出场顺序：文章导入时间、句子编号、句内偏移
  sort_time      INTEGER NOT NULL,
  sort_sentence  INTEGER NOT NULL,
  sort_offset    INTEGER NOT NULL,
  -- 题型阶段：new 尚未认识；cloze 语境填空；recall 纯中文默写
  stage          TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'cloze', 'recall')),
  cloze_streak   INTEGER NOT NULL DEFAULT 0,
  example_cursor INTEGER NOT NULL DEFAULT 0,
  introduced_at  INTEGER,
  introduced_day TEXT,
  -- 调度：fsrs_card 是 ts-fsrs 卡片的 JSON，due 与 scheduled_days 为便于查询的冗余
  due            INTEGER,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  fsrs_card      TEXT,
  deleted_at     INTEGER
);

CREATE TABLE examples (
  id                TEXT PRIMARY KEY,
  chunk_id          TEXT NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
  sentence_id       TEXT NOT NULL REFERENCES sentences (id) ON DELETE CASCADE,
  article_id        TEXT NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  surface           TEXT NOT NULL,
  start_in_sentence INTEGER NOT NULL,
  created_at        INTEGER NOT NULL,
  UNIQUE (chunk_id, sentence_id)
);

CREATE TABLE alt_answers (
  id         TEXT PRIMARY KEY,
  chunk_id   TEXT NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE reviews (
  id            TEXT PRIMARY KEY,
  chunk_id      TEXT NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
  example_id    TEXT,
  mode          TEXT NOT NULL CHECK (mode IN ('cloze', 'recall')),
  answered_at   INTEGER NOT NULL,
  study_day     TEXT NOT NULL,
  input         TEXT NOT NULL,
  rating        TEXT NOT NULL CHECK (rating IN ('good', 'hard', 'again')),
  -- 1 = 当天第一次答题，计入调度；0 = 本轮重出的练习
  counted       INTEGER NOT NULL,
  viewed_answer INTEGER NOT NULL DEFAULT 0,
  duration_ms   INTEGER NOT NULL,
  overridden    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE ignored_lemmas (
  lemma_key  TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- 每个学习日开始时已到期的句块快照，用于连续学习天数
CREATE TABLE day_due (
  study_day TEXT NOT NULL,
  chunk_id  TEXT NOT NULL,
  PRIMARY KEY (study_day, chunk_id)
);

CREATE TABLE days (
  study_day TEXT PRIMARY KEY,
  completed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX idx_sentences_article ON sentences (article_id, idx);
CREATE INDEX idx_batches_article ON extraction_batches (article_id);
CREATE INDEX idx_chunks_lemma_key ON chunks (lemma_key);
CREATE INDEX idx_chunks_due ON chunks (due);
CREATE INDEX idx_examples_chunk ON examples (chunk_id);
CREATE INDEX idx_examples_article ON examples (article_id);
CREATE INDEX idx_alt_answers_chunk ON alt_answers (chunk_id);
CREATE INDEX idx_reviews_chunk_day ON reviews (chunk_id, study_day);
CREATE INDEX idx_reviews_day ON reviews (study_day);

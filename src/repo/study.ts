/**
 * 练习相关的读写（需求第 5 节）：组一轮练习、认识、记录答题、“我写的也对”。
 * 规则本身（评级、调度、升降级、出题顺序）都在 core/srs，这里只负责读写数据库。
 */
import { lemmaKey } from "../core/judge/normalize";
import { studyDay } from "../core/srs/day";
import { type ChunkProgress, applyCountedAnswer } from "../core/srs/progress";
import { type Rating, rate } from "../core/srs/rating";
import { scheduleKnown } from "../core/srs/scheduler";
import { CLOZE_STREAK_TO_PROMOTE, type QuestionMode, type Stage } from "../core/srs/stage";
import { type Db, type Statement, newId } from "./db";
import { currentBookId, freshCount, nextNewChunks } from "./books";
import { DUE_CONDITION, INTRODUCED_IN_QUOTA, endOfDay, refreshDay } from "./stats";

export interface StudyExample {
  id: string;
  sentence: string;
  /** 原文形式 */
  surface: string;
  /** 原文形式在句中的位置 */
  start: number;
  /** 例句的中文翻译（词书里的例句才有） */
  translation: string | null;
  /** 来自文章时为文章编号；来自词书时为 null */
  articleId: string | null;
  /** 出处：文章标题或书名 */
  sourceTitle: string;
}

export interface StudyChunk {
  id: string;
  lemma: string;
  meaning: string;
  progress: ChunkProgress;
  examples: StudyExample[];
  altAnswers: string[];
}

interface ProgressRow {
  stage: Stage;
  cloze_streak: number;
  example_cursor: number;
  fsrs_card: string | null;
  due: number | null;
  scheduled_days: number;
}

/** 读例句用的列，需 LEFT JOIN articles a、books b */
export const EXAMPLE_COLUMNS = `e.id, e.sentence_text AS sentence, e.surface, e.start_in_sentence AS start,
  e.translation, e.article_id, COALESCE(a.title, b.title) AS title`;

const PROGRESS_COLUMNS = "stage, cloze_streak, example_cursor, fsrs_card, due, scheduled_days";

function toProgress(row: ProgressRow): ChunkProgress {
  return {
    stage: row.stage,
    clozeStreak: row.cloze_streak,
    exampleCursor: row.example_cursor,
    fsrsCard: row.fsrs_card,
    due: row.due,
    scheduledDays: row.scheduled_days,
  };
}

function progressUpdate(chunkId: string, p: ChunkProgress): Statement {
  return {
    sql: `UPDATE chunks SET stage = ?, cloze_streak = ?, example_cursor = ?, fsrs_card = ?, due = ?, scheduled_days = ?
          WHERE id = ?`,
    params: [p.stage, p.clozeStreak, p.exampleCursor, p.fsrsCard, p.due, p.scheduledDays, chunkId],
  };
}

export async function loadStudyChunk(db: Db, chunkId: string): Promise<StudyChunk | null> {
  const [row] = await db.query<ProgressRow & { id: string; lemma: string; meaning: string }>(
    `SELECT id, lemma, meaning, ${PROGRESS_COLUMNS} FROM chunks WHERE id = ? AND deleted_at IS NULL`,
    [chunkId],
  );
  if (!row) return null;
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
     WHERE e.chunk_id = ?
     ORDER BY e.created_at, e.id`,
    [chunkId],
  );
  const alts = await db.query<{ text: string }>(
    "SELECT text FROM alt_answers WHERE chunk_id = ? ORDER BY created_at, id",
    [chunkId],
  );
  return {
    id: row.id,
    lemma: row.lemma,
    meaning: row.meaning,
    progress: toProgress(row),
    examples: examples.map((e) => ({
      id: e.id,
      sentence: e.sentence,
      surface: e.surface,
      start: e.start,
      translation: e.translation,
      articleId: e.article_id,
      sourceTitle: e.title ?? "",
    })),
    altAnswers: alts.map((a) => a.text),
  };
}

/** 今天已经学过的新句块数（额外练习中学的不算，不占每日额度） */
export async function introducedOn(db: Db, day: string): Promise<number> {
  const [row] = await db.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM chunks WHERE ${INTRODUCED_IN_QUOTA}`,
    [day],
  );
  return row?.n ?? 0;
}

/** 今天还能学的新句块数：每日额度减去今天已认识的，且不超过库里剩下的新句块 */
export async function newAvailableToday(
  db: Db,
  dailyNew: number,
  now: number,
  bookId?: string,
): Promise<number> {
  const today = studyDay(now);
  const used = await introducedOn(db, today);
  const available = await freshCount(db, bookId ?? (await currentBookId(db)));
  return Math.max(0, Math.min(dailyNew - used, available));
}

export interface SessionChunks {
  /** 今天到期的复习，按到期先后 */
  dueIds: string[];
  /** 这一轮要学的新句块，按当前词书中的顺序 */
  newIds: string[];
}

/** 额外练习每次学的新句块数 */
export const EXTRA_COUNT = 30;

/**
 * 一轮练习要用到的句块（需求 5.6）。
 * 每日任务：全部到期复习，加上当前词书里今日剩余额度个新句块；
 * 额外练习：只有当前词书里的 newCount 个新句块，不含复习。
 */
export async function sessionChunks(
  db: Db,
  newCount: number,
  now: number,
  options: { bookId?: string; extra?: boolean } = {},
): Promise<SessionChunks> {
  const today = studyDay(now);
  const due = options.extra
    ? []
    : await db.query<{ id: string }>(
        `SELECT id FROM chunks WHERE ${DUE_CONDITION}
         ORDER BY due IS NOT NULL, due, sort_time, sort_sentence, sort_offset, id`,
        [endOfDay(today)],
      );
  const newIds = await nextNewChunks(db, options.bookId ?? (await currentBookId(db)), newCount);
  return { dueIds: due.map((r) => r.id), newIds };
}

/**
 * 跟写完成（相当于原来的“认识”）：进入语境填空。
 * 每日任务中学的占用当天的新句块额度；额外练习中学的（extra）不占。
 */
export async function introduceChunk(
  db: Db,
  chunkId: string,
  now: number,
  extra = false,
): Promise<void> {
  await db.transaction([
    {
      sql: `UPDATE chunks SET stage = 'cloze', cloze_streak = 0, introduced_at = ?, introduced_day = ?,
              introduced_extra = ?
            WHERE id = ? AND stage = 'new'`,
      params: [now, studyDay(now), extra ? 1 : 0, chunkId],
    },
  ]);
}

/** 标记“熟练”前的状态，撤销时用 */
export interface KnownMark {
  chunkId: string;
  before: ChunkProgress;
  introducedAt: number | null;
  introducedDay: string | null;
  introducedExtra: number;
  /** 今天开始时它是否在到期复习里（影响打卡） */
  dueToday: boolean;
}

/**
 * 标记“熟练”：直接进入纯中文默写阶段，下次复习排到几十天后（见 scheduleKnown）。
 * 不写答题记录；新短语不占当天的新短语额度；也不再算作今天必须完成的复习。
 */
export async function markKnown(db: Db, chunkId: string, now: number): Promise<KnownMark> {
  const day = studyDay(now);
  const [row] = await db.query<
    ProgressRow & {
      introduced_at: number | null;
      introduced_day: string | null;
      introduced_extra: number;
    }
  >(
    `SELECT ${PROGRESS_COLUMNS}, introduced_at, introduced_day, introduced_extra
     FROM chunks WHERE id = ? AND deleted_at IS NULL`,
    [chunkId],
  );
  if (!row) throw new Error("短语不存在");
  const [due] = await db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM day_due WHERE study_day = ? AND chunk_id = ?",
    [day, chunkId],
  );
  const before = toProgress(row);
  const scheduled = scheduleKnown(before.fsrsCard, now);
  const statements: Statement[] = [
    progressUpdate(chunkId, {
      ...before,
      stage: "recall",
      clozeStreak: Math.max(before.clozeStreak, CLOZE_STREAK_TO_PROMOTE),
      fsrsCard: scheduled.card,
      due: scheduled.due,
      scheduledDays: scheduled.scheduledDays,
    }),
    { sql: "DELETE FROM day_due WHERE study_day = ? AND chunk_id = ?", params: [day, chunkId] },
  ];
  if (row.introduced_at === null) {
    statements.push({
      sql: "UPDATE chunks SET introduced_at = ?, introduced_day = ?, introduced_extra = 1 WHERE id = ?",
      params: [now, day, chunkId],
    });
  }
  await db.transaction(statements);
  await refreshDay(db, day);
  return {
    chunkId,
    before,
    introducedAt: row.introduced_at,
    introducedDay: row.introduced_day,
    introducedExtra: row.introduced_extra,
    dueToday: (due?.n ?? 0) > 0,
  };
}

/** 撤销“熟练”，恢复到标记之前 */
export async function undoMarkKnown(db: Db, mark: KnownMark, now: number): Promise<void> {
  const statements: Statement[] = [
    progressUpdate(mark.chunkId, mark.before),
    {
      sql: "UPDATE chunks SET introduced_at = ?, introduced_day = ?, introduced_extra = ? WHERE id = ?",
      params: [mark.introducedAt, mark.introducedDay, mark.introducedExtra, mark.chunkId],
    },
  ];
  if (mark.dueToday) {
    statements.push({
      sql: "INSERT OR IGNORE INTO day_due (study_day, chunk_id) VALUES (?, ?)",
      params: [studyDay(now), mark.chunkId],
    });
  }
  await db.transaction(statements);
}

export interface AnswerInput {
  chunkId: string;
  mode: QuestionMode;
  exampleId: string | null;
  input: string;
  correct: boolean;
  viewedAnswer: boolean;
  durationMs: number;
  /** “写得慢”的时长，毫秒 */
  slowMs: number;
  now: number;
}

/** 一次答题的记录，改判时需要 */
export interface AnswerRecord {
  reviewId: string;
  chunkId: string;
  mode: QuestionMode;
  input: string;
  rating: Rating;
  /** 是否为当天第一次答题、计入了调度 */
  counted: boolean;
  /** 答题前的进度快照 */
  before: ChunkProgress;
  answeredAt: number;
}

/**
 * 记录一次答题（需求 5.5、5.6）。每个句块每天只有第一次答题计入调度和升降级；
 * 本轮重出的几次只写复习记录。
 */
export async function recordAnswer(db: Db, answer: AnswerInput): Promise<AnswerRecord> {
  const day = studyDay(answer.now);
  const [row] = await db.query<ProgressRow>(`SELECT ${PROGRESS_COLUMNS} FROM chunks WHERE id = ?`, [
    answer.chunkId,
  ]);
  if (!row) throw new Error("短语不存在");
  const before = toProgress(row);
  const [already] = await db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM reviews WHERE chunk_id = ? AND study_day = ? AND counted = 1",
    [answer.chunkId, day],
  );
  const counted = (already?.n ?? 0) === 0;
  const rating = rate(answer, answer.slowMs);
  const reviewId = newId();

  const statements: Statement[] = [
    {
      sql: `INSERT INTO reviews (id, chunk_id, example_id, mode, answered_at, study_day, input, rating, counted, viewed_answer, duration_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        reviewId,
        answer.chunkId,
        answer.exampleId,
        answer.mode,
        answer.now,
        day,
        answer.input,
        rating,
        counted ? 1 : 0,
        answer.viewedAnswer ? 1 : 0,
        Math.round(answer.durationMs),
      ],
    },
  ];
  if (counted) {
    statements.push(
      progressUpdate(answer.chunkId, applyCountedAnswer(before, answer.mode, rating, answer.now)),
    );
  }
  await db.transaction(statements);
  await refreshDay(db, day);
  return {
    reviewId,
    chunkId: answer.chunkId,
    mode: answer.mode,
    input: answer.input,
    rating,
    counted,
    before,
    answeredAt: answer.now,
  };
}

/**
 * “我写的也对”（需求 5.5）：本次改判为“好”。
 * 计入调度的那次从答题前的快照重新按“好”调度；
 * 纯中文默写中，这种写法同时存为备选答案。
 */
export async function overrideAnswer(db: Db, record: AnswerRecord, now: number): Promise<void> {
  const statements: Statement[] = [
    {
      sql: "UPDATE reviews SET rating = 'good', overridden = 1 WHERE id = ?",
      params: [record.reviewId],
    },
  ];
  if (record.counted) {
    statements.push(
      progressUpdate(
        record.chunkId,
        applyCountedAnswer(record.before, record.mode, "good", record.answeredAt),
      ),
    );
  }
  const text = record.input.trim().replace(/\s+/g, " ");
  if (record.mode === "recall" && text) {
    const [chunk] = await db.query<{ lemma: string }>("SELECT lemma FROM chunks WHERE id = ?", [
      record.chunkId,
    ]);
    const alts = await db.query<{ text: string }>(
      "SELECT text FROM alt_answers WHERE chunk_id = ?",
      [record.chunkId],
    );
    const known = new Set([chunk?.lemma ?? "", ...alts.map((a) => a.text)].map(lemmaKey));
    if (!known.has(lemmaKey(text))) {
      statements.push({
        sql: "INSERT INTO alt_answers (id, chunk_id, text, created_at) VALUES (?, ?, ?, ?)",
        params: [newId(), record.chunkId, text, now],
      });
    }
  }
  await db.transaction(statements);
}

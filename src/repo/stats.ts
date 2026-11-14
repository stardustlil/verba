/**
 * 首页数据与连续学习天数（需求第 6 节）。
 * 每个学习日第一次用到时，记下“当天开始时已到期的复习”快照；
 * 之后每次答题都重新判断当天是否完成。
 */
import { addDays, dayStart, studyDay } from "../core/srs/day";
import { MASTERED_INTERVAL_DAYS } from "../core/srs/scheduler";
import { computeStreak, isDayComplete } from "../core/srs/streak";
import { currentBookId, freshCount } from "./books";
import type { Db } from "./db";

/** 下一个学习日开始的时刻：在此之前到期的都算这一天到期 */
export function endOfDay(day: string): number {
  return dayStart(addDays(day, 1));
}

/** 当天跟写完成、占用每日额度的句块（参数为学习日）；额外练习中学的不算 */
export const INTRODUCED_IN_QUOTA =
  "deleted_at IS NULL AND introduced_day = ? AND introduced_extra = 0";

/** 某天到期的复习：已认识且到期，或认识后还没做过第一次语境填空。参数为 endOfDay(day) */
export const DUE_CONDITION = "deleted_at IS NULL AND stage != 'new' AND (due IS NULL OR due < ?)";

/** 记下这一天开始时已到期的复习。已经记过的不再重记。 */
export async function ensureDay(db: Db, day: string): Promise<void> {
  const [row] = await db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM days WHERE study_day = ?",
    [day],
  );
  if ((row?.n ?? 0) > 0) return;
  await db.transaction([
    { sql: "INSERT OR IGNORE INTO days (study_day, completed) VALUES (?, 0)", params: [day] },
    {
      sql: `INSERT OR IGNORE INTO day_due (study_day, chunk_id)
            SELECT ?, id FROM chunks WHERE ${DUE_CONDITION}`,
      params: [day, endOfDay(day)],
    },
  ]);
}

/** 重新判断这一天是否完成，并记下结果 */
export async function refreshDay(db: Db, day: string): Promise<boolean> {
  await ensureDay(db, day);
  const dueAtStart = await db.query<{ chunk_id: string }>(
    `SELECT d.chunk_id FROM day_due d JOIN chunks c ON c.id = d.chunk_id
     WHERE d.study_day = ? AND c.deleted_at IS NULL`,
    [day],
  );
  const answered = await db.query<{ chunk_id: string }>(
    "SELECT DISTINCT chunk_id FROM reviews WHERE study_day = ? AND counted = 1",
    [day],
  );
  const [count] = await db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM reviews WHERE study_day = ?",
    [day],
  );
  const complete = isDayComplete({
    dueAtStart: dueAtStart.map((r) => r.chunk_id),
    answered: new Set(answered.map((r) => r.chunk_id)),
    answerCount: count?.n ?? 0,
  });
  // 已完成的一天保持完成：之后删除句块或文章，不会把当天的完成记录抹掉
  if (complete) {
    await db.transaction([
      { sql: "UPDATE days SET completed = 1 WHERE study_day = ?", params: [day] },
    ]);
  }
  return complete;
}

export interface HomeStats {
  /** 今日待复习 */
  dueToday: number;
  /** 今日新句块（剩余额度与库存中较小的） */
  newToday: number;
  /** 今日已完成：今天答过题的句块数 */
  doneToday: number;
  streak: number;
  mastered: number;
  total: number;
}

export async function homeStats(
  db: Db,
  dailyNew: number,
  now: number,
  bookId?: string,
): Promise<HomeStats> {
  const today = studyDay(now);
  await refreshDay(db, today);
  const [row] = await db.query<{
    due: number;
    introduced: number;
    done: number;
    mastered: number;
    total: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM chunks WHERE ${DUE_CONDITION}) AS due,
       (SELECT COUNT(*) FROM chunks WHERE ${INTRODUCED_IN_QUOTA}) AS introduced,
       (SELECT COUNT(DISTINCT r.chunk_id) FROM reviews r JOIN chunks c ON c.id = r.chunk_id
          WHERE r.study_day = ? AND r.counted = 1 AND c.deleted_at IS NULL) AS done,
       (SELECT COUNT(*) FROM chunks
          WHERE deleted_at IS NULL AND stage != 'new' AND scheduled_days >= ?) AS mastered,
       (SELECT COUNT(*) FROM chunks WHERE deleted_at IS NULL) AS total`,
    [endOfDay(today), today, today, MASTERED_INTERVAL_DAYS],
  );
  const completed = await db.query<{ study_day: string }>(
    "SELECT study_day FROM days WHERE completed = 1",
  );
  return {
    dueToday: row?.due ?? 0,
    newToday: Math.max(
      0,
      Math.min(
        dailyNew - (row?.introduced ?? 0),
        await freshCount(db, bookId ?? (await currentBookId(db))),
      ),
    ),
    doneToday: row?.done ?? 0,
    streak: computeStreak(
      completed.map((r) => r.study_day),
      today,
    ),
    mastered: row?.mastered ?? 0,
    total: row?.total ?? 0,
  };
}

/** 把一段学习时长累加到某个学习日 */
export async function addStudyTime(db: Db, day: string, ms: number): Promise<void> {
  if (!(ms > 0)) return;
  await ensureDay(db, day);
  await db.transaction([
    {
      sql: "UPDATE days SET study_ms = study_ms + ? WHERE study_day = ?",
      params: [Math.round(ms), day],
    },
  ]);
}

export interface DayRecord {
  day: string;
  /** 当天是否完成（计入连续天数） */
  completed: boolean;
  studyMs: number;
  /** 当天答过题的句块数 */
  answered: number;
}

/** 以今天为最后一天的连续 n 天记录，用于首页的练习热图 */
export async function recentDays(db: Db, now: number, n = 7): Promise<DayRecord[]> {
  const today = studyDay(now);
  const days = Array.from({ length: n }, (_, i) => addDays(today, i - n + 1));
  const rows = await db.query<{ study_day: string; completed: number; study_ms: number }>(
    `SELECT study_day, completed, study_ms FROM days WHERE study_day >= ? AND study_day <= ?`,
    [days[0]!, today],
  );
  const answered = await db.query<{ study_day: string; n: number }>(
    `SELECT study_day, COUNT(DISTINCT chunk_id) AS n FROM reviews
     WHERE study_day >= ? AND study_day <= ? GROUP BY study_day`,
    [days[0]!, today],
  );
  const byDay = new Map(rows.map((r) => [r.study_day, r]));
  const counts = new Map(answered.map((r) => [r.study_day, r.n]));
  return days.map((day) => ({
    day,
    completed: byDay.get(day)?.completed === 1,
    studyMs: byDay.get(day)?.study_ms ?? 0,
    answered: counts.get(day) ?? 0,
  }));
}

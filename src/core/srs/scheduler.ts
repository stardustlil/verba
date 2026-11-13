/**
 * 复习调度（需求 5.6）：FSRS，评级对应 好→Good、一般→Hard、忘了→Again，不使用 Easy。
 * 关闭分钟级的短期学习步骤，最小间隔为 1 天，与“每天只有第一次答题计入调度”一致。
 */
import { type Card, type Grade, Rating as FsrsRating, createEmptyCard, fsrs } from "ts-fsrs";
import type { Rating } from "./rating";

/** 复习间隔达到这个天数即为“已掌握”（需求第 4 节） */
export const MASTERED_INTERVAL_DAYS = 21;

const scheduler = fsrs({ enable_short_term: false, enable_fuzz: false });

const GRADES: Record<Rating, Grade> = {
  good: FsrsRating.Good,
  hard: FsrsRating.Hard,
  again: FsrsRating.Again,
};

export interface Scheduled {
  /** 序列化后的 FSRS 卡片，原样存库，下次调度时传回 */
  card: string;
  /** 下次复习时刻的毫秒时间戳 */
  due: number;
  scheduledDays: number;
}

function revive(card: string): Card {
  const raw = JSON.parse(card) as Card & { due: string; last_review?: string };
  return {
    ...raw,
    due: new Date(raw.due),
    last_review: raw.last_review ? new Date(raw.last_review) : undefined,
  };
}

/**
 * 根据一次计入调度的答题结果安排下次复习。
 * card 为 null 表示这是该句块的第一次评级。
 */
export function schedule(card: string | null, rating: Rating, now: number): Scheduled {
  const at = new Date(now);
  const current = card === null ? createEmptyCard(at) : revive(card);
  const next = scheduler.next(current, at, GRADES[rating]).card;
  return {
    card: JSON.stringify(next),
    due: next.due.getTime(),
    scheduledDays: next.scheduled_days,
  };
}

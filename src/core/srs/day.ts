/**
 * 学习日：一天从凌晨 4 点开始计算（需求 5.6），按本地时区。
 * 学习日写作 'YYYY-MM-DD'。
 */

export const DAY_START_HOUR = 4;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function format(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parse(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** 某个时刻所属的学习日 */
export function studyDay(at: number | Date): string {
  const date = new Date(at);
  date.setHours(date.getHours() - DAY_START_HOUR);
  return format(date);
}

/** 学习日开始的时刻（当天凌晨 4 点）的毫秒时间戳 */
export function dayStart(day: string): number {
  const date = parse(day);
  date.setHours(DAY_START_HOUR, 0, 0, 0);
  return date.getTime();
}

export function addDays(day: string, n: number): string {
  const date = parse(day);
  date.setDate(date.getDate() + n);
  return format(date);
}

/** 句块在某个学习日是否到期：按天计，不看具体钟点 */
export function isDueOn(due: number, day: string): boolean {
  return studyDay(due) <= day;
}

/**
 * 数据库访问的最小接口。业务 SQL 都写在 src/repo 下，
 * 应用里通过 Tauri 调用 Rust 端执行，测试里用 Node 自带的 SQLite 执行。
 */

export type SqlValue = string | number | null;

export interface Statement {
  sql: string;
  params?: SqlValue[];
}

export interface Db {
  query<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** 在一个事务里依次执行，任何一条失败则全部回滚 */
  transaction(statements: Statement[]): Promise<void>;
}

export function newId(): string {
  return crypto.randomUUID();
}

/** 生成 IN (?, ?, …) 用的占位符 */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

/**
 * 仅供测试和脚本使用：用 Node 自带的 SQLite 在内存里建库，执行与应用相同的迁移脚本。
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { Db, SqlValue, Statement } from "../db";

// 用字符串拼路径：jsdom 环境里全局的 URL 不是 Node 的 URL
const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../src-tauri/migrations",
);

export function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

/**
 * 与 Rust 端相同的迁移方式：迁移期间关闭外键，每个迁移一个事务，提交前检查外键。
 * upTo 为执行到第几个迁移为止（测试用来模拟旧版本的数据库）。
 */
export function migrateNodeDb(database: DatabaseSync, upTo = Infinity): void {
  const [row] = database.prepare("PRAGMA user_version").all() as Array<{ user_version: number }>;
  const files = migrationFiles();
  database.exec("PRAGMA foreign_keys = OFF");
  for (let i = row?.user_version ?? 0; i < Math.min(files.length, upTo); i++) {
    database.exec("BEGIN");
    try {
      database.exec(readFileSync(join(migrationsDir, files[i]!), "utf8"));
      const broken = database
        .prepare("SELECT COUNT(*) AS n FROM pragma_foreign_key_check")
        .get() as {
        n: number;
      };
      if (broken.n > 0) throw new Error(`迁移 ${files[i]} 后外键不完整`);
      database.exec(`PRAGMA user_version = ${i + 1}`);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  database.exec("PRAGMA foreign_keys = ON");
}

export function wrapNodeDb(database: DatabaseSync): Db {
  return {
    async query<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      return database
        .prepare(sql)
        .all(...params)
        .map((row) => ({ ...row }) as T);
    },
    async transaction(statements: Statement[]): Promise<void> {
      database.exec("BEGIN");
      try {
        for (const statement of statements) {
          database.prepare(statement.sql).run(...(statement.params ?? []));
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

export function createNodeDb(): Db {
  const database = new DatabaseSync(":memory:");
  migrateNodeDb(database);
  return wrapNodeDb(database);
}

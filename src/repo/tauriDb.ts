import { invoke } from "@tauri-apps/api/core";
import type { Db, SqlValue, Statement } from "./db";

export const tauriDb: Db = {
  query<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    return invoke<T[]>("db_query", { sql, params });
  },
  async transaction(statements: Statement[]): Promise<void> {
    if (statements.length === 0) return;
    await invoke("db_transaction", {
      statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })),
    });
  },
};

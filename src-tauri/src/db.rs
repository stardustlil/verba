//! SQLite 执行器。业务 SQL 写在前端的数据层，这里只负责
//! 打开数据库、执行迁移，以及在单个事务里执行一组语句。

use std::path::Path;
use std::sync::Mutex;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::Deserialize;
use serde_json::{Map, Number, Value};

/// 按顺序执行的迁移脚本；下标 + 1 即 `PRAGMA user_version`。
const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/001_init.sql"),
    include_str!("../migrations/002_books.sql"),
    include_str!("../migrations/003_extra.sql"),
];

pub struct Db(pub Mutex<Connection>);

#[derive(Deserialize)]
pub struct Statement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Value>,
}

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let mut conn = Connection::open(path)?;
    configure(&mut conn)?;
    Ok(conn)
}

fn configure(conn: &mut Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(conn)
}

/// 按 SQLite 官方的改表步骤执行迁移：迁移期间关闭外键（否则重建表时删除旧表会级联删除数据），
/// 在事务内执行，提交前检查外键是否完整，最后恢复外键。
fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let current = usize::try_from(current).unwrap_or(0);
    if current >= MIGRATIONS.len() {
        return Ok(());
    }
    let foreign_keys: i64 = conn.query_row("PRAGMA foreign_keys", [], |row| row.get(0))?;
    conn.pragma_update(None, "foreign_keys", "OFF")?;
    let result = run_migrations(conn, current);
    conn.pragma_update(None, "foreign_keys", foreign_keys)?;
    result
}

fn run_migrations(conn: &mut Connection, current: usize) -> rusqlite::Result<()> {
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        let broken: i64 = tx.query_row(
            "SELECT COUNT(*) FROM pragma_foreign_key_check",
            [],
            |row| row.get(0),
        )?;
        if broken > 0 {
            return Err(rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
                Some(format!("迁移 {} 后有 {broken} 处外键不完整", index + 1)),
            ));
        }
        tx.pragma_update(None, "user_version", (index + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

fn to_sql(value: &Value) -> Result<SqlValue, String> {
    match value {
        Value::Null => Ok(SqlValue::Null),
        Value::Bool(b) => Ok(SqlValue::Integer(i64::from(*b))),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Ok(SqlValue::Integer(i))
            } else if let Some(f) = n.as_f64() {
                Ok(SqlValue::Real(f))
            } else {
                Err(format!("不支持的数值参数：{n}"))
            }
        }
        Value::String(s) => Ok(SqlValue::Text(s.clone())),
        Value::Array(_) | Value::Object(_) => Err("参数不能是数组或对象".to_string()),
    }
}

fn from_sql(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::Number(i.into()),
        ValueRef::Real(f) => Number::from_f64(f).map_or(Value::Null, Value::Number),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(_) => Value::Null,
    }
}

fn bind(params: &[Value]) -> Result<Vec<SqlValue>, String> {
    params.iter().map(to_sql).collect()
}

pub fn query(
    conn: &Connection,
    sql: &str,
    params: &[Value],
) -> Result<Vec<Map<String, Value>>, String> {
    let bound = bind(params)?;
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let names: Vec<String> = stmt.column_names().into_iter().map(|s| s.to_string()).collect();
    let mut rows = stmt
        .query(params_from_iter(bound))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut record = Map::with_capacity(names.len());
        for (i, name) in names.iter().enumerate() {
            let value = row.get_ref(i).map_err(|e| e.to_string())?;
            record.insert(name.clone(), from_sql(value));
        }
        out.push(record);
    }
    Ok(out)
}

/// 在一个事务里依次执行全部语句，任何一条失败则全部回滚。
/// 返回每条语句影响的行数。
pub fn transaction(conn: &mut Connection, statements: &[Statement]) -> Result<Vec<usize>, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut changes = Vec::with_capacity(statements.len());
    for statement in statements {
        let bound = bind(&statement.params)?;
        let changed = tx
            .execute(&statement.sql, params_from_iter(bound))
            .map_err(|e| format!("{e}（语句：{}）", statement.sql))?;
        changes.push(changed);
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(changes)
}

#[tauri::command]
pub fn db_query(
    db: tauri::State<'_, Db>,
    sql: String,
    params: Option<Vec<Value>>,
) -> Result<Vec<Map<String, Value>>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    query(&conn, &sql, &params.unwrap_or_default())
}

#[tauri::command]
pub fn db_transaction(
    db: tauri::State<'_, Db>,
    statements: Vec<Statement>,
) -> Result<Vec<usize>, String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    transaction(&mut conn, &statements)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn memory() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&mut conn).unwrap();
        conn
    }

    fn stmt(sql: &str, params: Value) -> Statement {
        Statement {
            sql: sql.to_string(),
            params: params.as_array().cloned().unwrap_or_default(),
        }
    }

    #[test]
    fn migrations_set_user_version_and_are_idempotent() {
        let mut conn = memory();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);
        migrate(&mut conn).unwrap();
        let tables = query(
            &conn,
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            &[json!("chunks")],
        )
        .unwrap();
        assert_eq!(tables.len(), 1);
    }

    #[test]
    fn open_creates_file_and_migrates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("verba.db");
        let conn = open(&path).unwrap();
        let rows = query(&conn, "SELECT COUNT(*) AS n FROM meta", &[]).unwrap();
        assert_eq!(rows[0]["n"], json!(0));
        drop(conn);
        // 再次打开不应重复执行迁移
        open(&path).unwrap();
    }

    #[test]
    fn transaction_round_trips_values() {
        let mut conn = memory();
        let changes = transaction(
            &mut conn,
            &[
                stmt(
                    "INSERT INTO meta (key, value) VALUES (?, ?)",
                    json!(["a", "1"]),
                ),
                stmt(
                    "INSERT INTO meta (key, value) VALUES (?, ?)",
                    json!(["b", "中文"]),
                ),
            ],
        )
        .unwrap();
        assert_eq!(changes, vec![1, 1]);
        let rows = query(
            &conn,
            "SELECT key, value, 1.5 AS f, NULL AS n FROM meta ORDER BY key",
            &[],
        )
        .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1]["value"], json!("中文"));
        assert_eq!(rows[0]["f"], json!(1.5));
        assert_eq!(rows[0]["n"], Value::Null);
    }

    #[test]
    fn transaction_rolls_back_on_failure() {
        let mut conn = memory();
        let result = transaction(
            &mut conn,
            &[
                stmt(
                    "INSERT INTO meta (key, value) VALUES (?, ?)",
                    json!(["a", "1"]),
                ),
                stmt(
                    "INSERT INTO meta (key, value) VALUES (?, ?)",
                    json!(["a", "2"]),
                ),
            ],
        );
        assert!(result.is_err());
        let rows = query(&conn, "SELECT COUNT(*) AS n FROM meta", &[]).unwrap();
        assert_eq!(rows[0]["n"], json!(0));
    }

    #[test]
    fn foreign_keys_cascade() {
        let mut conn = memory();
        transaction(
            &mut conn,
            &[
                stmt(
                    "INSERT INTO articles (id, title, source_type, text, created_at) VALUES ('a', 't', 'paste', 'x', 0)",
                    json!([]),
                ),
                stmt(
                    "INSERT INTO sentences (id, article_id, idx, paragraph_idx, text, start_offset, end_offset) VALUES ('s', 'a', 0, 0, 'x', 0, 1)",
                    json!([]),
                ),
                stmt("DELETE FROM articles WHERE id = 'a'", json!([])),
            ],
        )
        .unwrap();
        let rows = query(&conn, "SELECT COUNT(*) AS n FROM sentences", &[]).unwrap();
        assert_eq!(rows[0]["n"], json!(0));
    }

    #[test]
    fn upgrade_from_001_keeps_data() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        conn.execute_batch(MIGRATIONS[0]).unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
        conn.execute_batch(
            "INSERT INTO articles (id, title, source_type, text, created_at) VALUES ('a', 't', 'paste', 'He ran into her.', 0);
             INSERT INTO sentences (id, article_id, idx, paragraph_idx, text, start_offset, end_offset) VALUES ('s', 'a', 0, 0, 'He ran into her.', 0, 16);
             INSERT INTO chunks (id, lemma, lemma_key, meaning, origin, created_at, sort_time, sort_sentence, sort_offset) VALUES ('c', 'run into', 'run into', '偶遇', 'ai', 0, 0, 0, 3);
             INSERT INTO examples (id, chunk_id, sentence_id, article_id, surface, start_in_sentence, created_at) VALUES ('e', 'c', 's', 'a', 'ran into', 3, 0);
             INSERT INTO alt_answers (id, chunk_id, text, created_at) VALUES ('x', 'c', 'bump into', 0);
             INSERT INTO reviews (id, chunk_id, mode, answered_at, study_day, input, rating, counted, duration_ms) VALUES ('r', 'c', 'cloze', 0, '2026-11-12', 'ran into', 'good', 1, 1000);",
        )
        .unwrap();
        migrate(&mut conn).unwrap();

        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);
        let fk: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(fk, 1);
        let rows = query(&conn, "SELECT sentence_text, surface FROM examples", &[]).unwrap();
        assert_eq!(rows[0]["sentence_text"], json!("He ran into her."));
        for table in ["chunks", "alt_answers", "reviews"] {
            let n = query(&conn, &format!("SELECT COUNT(*) AS n FROM {table}"), &[]).unwrap();
            assert_eq!(n[0]["n"], json!(1), "{table}");
        }
        // 外键在重建后的表上依然生效：删除句块会级联删除例句和复习记录
        conn.execute("DELETE FROM chunks WHERE id = 'c'", []).unwrap();
        let n = query(&conn, "SELECT (SELECT COUNT(*) FROM examples) + (SELECT COUNT(*) FROM reviews) AS n", &[]).unwrap();
        assert_eq!(n[0]["n"], json!(0));
    }

    #[test]
    fn rejects_structured_params() {
        let conn = memory();
        assert!(query(&conn, "SELECT ?", &[json!([1])]).is_err());
    }
}

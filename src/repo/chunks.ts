/** 句块的读写：导入时的去重查询、修改释义、删除与撤销 */
import type { LibrarySense } from "../core/extract/resolve";
import { type Db, placeholders } from "./db";

/** 忽略名单中的全部原形去重键（需求 5.2） */
export async function ignoredKeys(db: Db): Promise<Set<string>> {
  const rows = await db.query<{ lemma_key: string }>("SELECT lemma_key FROM ignored_lemmas");
  return new Set(rows.map((r) => r.lemma_key));
}

/** 库中与给定原形相同的全部义项，连同它们的例句原文，用于去重（需求 3.6） */
export async function sensesForKeys(db: Db, keys: string[]): Promise<Map<string, LibrarySense[]>> {
  const result = new Map<string, LibrarySense[]>();
  const unique = [...new Set(keys)];
  if (unique.length === 0) return result;

  const chunks = await db.query<{ id: string; lemma_key: string; meaning: string }>(
    `SELECT id, lemma_key, meaning FROM chunks
     WHERE deleted_at IS NULL AND lemma_key IN (${placeholders(unique.length)})
     ORDER BY created_at, id`,
    unique,
  );
  if (chunks.length === 0) return result;

  const examples = await db.query<{ chunk_id: string; text: string }>(
    `SELECT e.chunk_id, e.sentence_text AS text FROM examples e
     WHERE e.chunk_id IN (${placeholders(chunks.length)})
     ORDER BY e.created_at, e.id`,
    chunks.map((c) => c.id),
  );
  const byChunk = new Map<string, string[]>();
  for (const example of examples) {
    byChunk.set(example.chunk_id, [...(byChunk.get(example.chunk_id) ?? []), example.text]);
  }
  for (const chunk of chunks) {
    const sense: LibrarySense = {
      chunkId: chunk.id,
      meaning: chunk.meaning,
      exampleSentences: byChunk.get(chunk.id) ?? [],
    };
    result.set(chunk.lemma_key, [...(result.get(chunk.lemma_key) ?? []), sense]);
  }
  return result;
}

/** 例句的判重键：同一个句子里的同一段原文 */
export function exampleKey(sentenceText: string, surface: string): string {
  return `${sentenceText}\n${surface.toLowerCase()}`;
}

/**
 * 这些句子里已经被收为例句的原文片段。
 * 重复导入同一段文字时，即使 AI 这次给出的原形写法不同，也不会重复建句块。
 */
export async function existingExampleKeys(db: Db, sentenceTexts: string[]): Promise<Set<string>> {
  const unique = [...new Set(sentenceTexts)];
  if (unique.length === 0) return new Set();
  const rows = await db.query<{ text: string; surface: string }>(
    `SELECT e.sentence_text AS text, e.surface FROM examples e
     JOIN chunks c ON c.id = e.chunk_id
     WHERE c.deleted_at IS NULL AND e.sentence_text IN (${placeholders(unique.length)})`,
    unique,
  );
  return new Set(rows.map((r) => exampleKey(r.text, r.surface)));
}

/** 修改中文释义 */
export async function updateMeaning(db: Db, chunkId: string, meaning: string): Promise<void> {
  const trimmed = meaning.trim();
  if (!trimmed) throw new Error("释义不能为空");
  await db.transaction([
    { sql: "UPDATE chunks SET meaning = ? WHERE id = ?", params: [trimmed, chunkId] },
  ]);
}

/** 删除后可撤销所需的信息 */
export interface DeletedChunk {
  chunkId: string;
  lemmaKey: string;
  /** 这次删除是否新加入了忽略名单；撤销时只撤回自己加的 */
  addedToIgnored: boolean;
}

/**
 * 删除句块（需求 5.2）：先软删除，以便撤销；原形进入忽略名单。
 * 软删除的句块在下次启动时彻底清除。
 */
export async function softDeleteChunk(
  db: Db,
  chunkId: string,
  now: number = Date.now(),
): Promise<DeletedChunk> {
  const [chunk] = await db.query<{ lemma_key: string }>(
    "SELECT lemma_key FROM chunks WHERE id = ?",
    [chunkId],
  );
  if (!chunk) throw new Error("短语不存在");
  const [ignored] = await db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM ignored_lemmas WHERE lemma_key = ?",
    [chunk.lemma_key],
  );
  const addedToIgnored = (ignored?.n ?? 0) === 0;
  await db.transaction([
    { sql: "UPDATE chunks SET deleted_at = ? WHERE id = ?", params: [now, chunkId] },
    {
      sql: "INSERT OR IGNORE INTO ignored_lemmas (lemma_key, created_at) VALUES (?, ?)",
      params: [chunk.lemma_key, now],
    },
  ]);
  return { chunkId, lemmaKey: chunk.lemma_key, addedToIgnored };
}

/** 撤销删除：恢复句块，并撤回这次删除加入忽略名单的原形 */
export async function undoDeleteChunk(db: Db, deleted: DeletedChunk): Promise<void> {
  const statements = [
    { sql: "UPDATE chunks SET deleted_at = NULL WHERE id = ?", params: [deleted.chunkId] },
  ];
  if (deleted.addedToIgnored) {
    statements.push({
      sql: "DELETE FROM ignored_lemmas WHERE lemma_key = ?",
      params: [deleted.lemmaKey],
    });
  }
  await db.transaction(statements);
}

/** 应用启动时彻底清除软删除的句块（例句、复习记录等随之级联删除） */
export async function purgeDeletedChunks(db: Db): Promise<void> {
  await db.transaction([{ sql: "DELETE FROM chunks WHERE deleted_at IS NOT NULL" }]);
}

export async function deleteAltAnswer(db: Db, altId: string): Promise<void> {
  await db.transaction([{ sql: "DELETE FROM alt_answers WHERE id = ?", params: [altId] }]);
}

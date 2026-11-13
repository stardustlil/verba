/**
 * 导入流程的后半段（需求 3.3–3.6）：对一篇文章尚未完成的批次执行
 * 抽取 → 规则校验 → 去重与义项判断 → 入库。
 * 某一批失败时，已成功的批次照常入库；失败的批次记下来，之后可以重试。
 */
import { extractBatch } from "../core/extract/pipeline";
import { type Resolution, resolveCandidates } from "../core/extract/resolve";
import type { AiClient } from "../core/extract/types";
import type { ValidationResult } from "../core/extract/validate";
import { type PendingBatch, getArticle, pendingBatches } from "./articles";
import { exampleKey, existingExampleKeys, ignoredKeys, sensesForKeys } from "./chunks";
import { type Db, type Statement, newId } from "./db";

export interface ImportSummary {
  /** 新建的句块数 */
  added: number;
  /** 合并为已有句块例句的数量 */
  merged: number;
  /** 这次处理的批次数 */
  batches: number;
  /** 其中失败的批次数 */
  failedBatches: number;
  /** 第一个失败批次的错误信息，用于提示 */
  firstError: string | null;
}

export interface ImportOptions {
  /** 每完成一批（无论成败）回调一次 */
  onProgress?: (done: number, total: number) => void;
  /** 同时进行的 AI 抽取请求数 */
  concurrency?: number;
  now?: () => number;
}

type Extraction = { ok: true; result: ValidationResult } | { ok: false; error: string };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 并发执行抽取，但保持结果与批次一一对应 */
function extractAll(
  ai: AiClient,
  batches: PendingBatch[],
  ignored: ReadonlySet<string>,
  concurrency: number,
): Promise<Extraction>[] {
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = () =>
    new Promise<void>((resolve) => {
      if (active < concurrency) {
        active++;
        resolve();
      } else {
        waiting.push(resolve);
      }
    });
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

  return batches.map(async (batch): Promise<Extraction> => {
    await acquire();
    try {
      return { ok: true, result: await extractBatch(ai, batch.sentences, ignored) };
    } catch (error) {
      return { ok: false, error: message(error) };
    } finally {
      release();
    }
  });
}

function insertStatements(
  resolutions: Resolution[],
  batch: PendingBatch,
  articleId: string,
  articleCreatedAt: number,
  now: number,
): Statement[] {
  const sentenceIds = new Map(batch.sentences.map((s) => [s.idx, s.id]));
  const sentenceTexts = new Map(batch.sentences.map((s) => [s.idx, s.text]));
  const statements: Statement[] = [];
  for (const resolution of resolutions) {
    if (resolution.kind === "skip") continue;
    const { candidate, chunkId } = resolution;
    const sentenceId = sentenceIds.get(candidate.sentenceIdx);
    if (!sentenceId) continue;
    if (resolution.kind === "new") {
      statements.push({
        sql: `INSERT INTO chunks (id, lemma, lemma_key, meaning, origin, created_at, sort_time, sort_sentence, sort_offset)
              VALUES (?, ?, ?, ?, 'ai', ?, ?, ?, ?)`,
        params: [
          chunkId,
          candidate.lemma,
          candidate.lemmaKey,
          candidate.meaning,
          now,
          articleCreatedAt,
          candidate.sentenceIdx,
          candidate.start,
        ],
      });
    }
    statements.push({
      sql: `INSERT INTO examples (id, chunk_id, sentence_id, article_id, sentence_text, surface, start_in_sentence, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (chunk_id, sentence_id) DO NOTHING`,
      params: [
        newId(),
        chunkId,
        sentenceId,
        articleId,
        sentenceTexts.get(candidate.sentenceIdx) ?? "",
        candidate.surface,
        candidate.start,
        now,
      ],
    });
  }
  return statements;
}

export async function runExtraction(
  db: Db,
  ai: AiClient,
  articleId: string,
  options: ImportOptions = {},
): Promise<ImportSummary> {
  const now = options.now ?? Date.now;
  const article = await getArticle(db, articleId);
  if (!article) throw new Error("文章不存在");

  const batches = await pendingBatches(db, articleId);
  const summary: ImportSummary = {
    added: 0,
    merged: 0,
    batches: batches.length,
    failedBatches: 0,
    firstError: null,
  };
  if (batches.length === 0) return summary;

  const ignored = await ignoredKeys(db);
  const extractions = extractAll(ai, batches, ignored, options.concurrency ?? 3);

  // 入库按批次顺序逐个进行，后面的批次能看到前面刚入库的句块，去重才准确
  for (const [i, batch] of batches.entries()) {
    const fail = async (error: string) => {
      summary.failedBatches++;
      summary.firstError ??= error;
      await db.transaction([
        {
          sql: "UPDATE extraction_batches SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
          params: [error.slice(0, 500), now(), batch.id],
        },
      ]);
    };

    const extraction = await extractions[i];
    if (!extraction || !extraction.ok) {
      await fail(extraction?.error ?? "抽取失败");
    } else {
      try {
        const sentenceTexts = new Map(batch.sentences.map((s) => [s.idx, s.text]));
        // 同一个句子里的同一段原文已经是例句的，直接跳过，不受原形写法影响
        const existing = await existingExampleKeys(db, [...sentenceTexts.values()]);
        const candidates = extraction.result.candidates.filter(
          (c) => !existing.has(exampleKey(sentenceTexts.get(c.sentenceIdx) ?? "", c.surface)),
        );
        const library = await sensesForKeys(
          db,
          candidates.map((c) => c.lemmaKey),
        );
        const resolutions = await resolveCandidates(ai, {
          candidates,
          sentenceText: (idx) => sentenceTexts.get(idx) ?? "",
          library,
          newId,
        });
        const at = now();
        await db.transaction([
          ...insertStatements(resolutions, batch, articleId, article.createdAt, at),
          {
            sql: "UPDATE extraction_batches SET status = 'done', error = NULL, updated_at = ? WHERE id = ?",
            params: [at, batch.id],
          },
        ]);
        summary.added += resolutions.filter((r) => r.kind === "new").length;
        summary.merged += resolutions.filter((r) => r.kind === "merge").length;
      } catch (error) {
        await fail(message(error));
      }
    }
    options.onProgress?.(i + 1, batches.length);
  }
  return summary;
}

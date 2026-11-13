/**
 * 句块抽取流程（需求 3.3）：按段落分批 → 调用 AI → 规则校验。
 */
import { arrayField, parseJsonLoose } from "./parse";
import { buildExtractMessages } from "./prompt";
import { AiFormatError, type AiClient, type SourceSentence } from "./types";
import { type ValidationResult, validateCandidates } from "./validate";

/** 每批句子的大致字符数上限。批太大时 AI 容易漏抽，太小则调用次数多 */
export const BATCH_MAX_CHARS = 1500;

/**
 * 按段落分批。一批内的句子编号必须连续（用户可能只选了不相邻的几段）。
 * 单个段落超长时按句子拆开。
 */
export function makeBatches(
  sentences: SourceSentence[],
  maxChars: number = BATCH_MAX_CHARS,
): SourceSentence[][] {
  const batches: SourceSentence[][] = [];
  let current: SourceSentence[] = [];
  let size = 0;

  const flush = () => {
    if (current.length > 0) batches.push(current);
    current = [];
    size = 0;
  };

  const paragraphs: SourceSentence[][] = [];
  for (const sentence of [...sentences].sort((a, b) => a.idx - b.idx)) {
    const last = paragraphs.at(-1);
    if (last && last[0]?.paragraphIdx === sentence.paragraphIdx) last.push(sentence);
    else paragraphs.push([sentence]);
  }

  for (const paragraph of paragraphs) {
    const length = paragraph.reduce((sum, s) => sum + s.text.length, 0);
    const previous = current.at(-1);
    const first = paragraph[0];
    const adjacent =
      previous === undefined || first === undefined || first.idx === previous.idx + 1;
    if (!adjacent || (current.length > 0 && size + length > maxChars)) flush();

    if (length > maxChars * 2) {
      // 超长段落：逐句累加，到上限就切一批
      for (const sentence of paragraph) {
        if (current.length > 0 && size + sentence.text.length > maxChars) flush();
        current.push(sentence);
        size += sentence.text.length;
      }
      flush();
    } else {
      current.push(...paragraph);
      size += length;
    }
  }
  flush();
  return batches;
}

/**
 * 调用 AI 并解析。返回格式不正确时重试一次（需求 3.4），仍失败则抛出 AiFormatError。
 * 网络错误等其他异常直接抛出，由调用方按批次失败处理。
 */
export async function chatJson<T>(
  ai: AiClient,
  messages: Parameters<AiClient["chat"]>[0],
  parse: (value: unknown) => T,
): Promise<T> {
  let lastError: AiFormatError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await ai.chat(messages, { json: true });
    try {
      return parse(parseJsonLoose(text));
    } catch (error) {
      if (!(error instanceof AiFormatError)) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new AiFormatError("AI 返回格式不正确");
}

/** 抽取一批句子中的句块 */
export async function extractBatch(
  ai: AiClient,
  sentences: SourceSentence[],
  ignored: ReadonlySet<string> = new Set(),
): Promise<ValidationResult> {
  const items = await chatJson(ai, buildExtractMessages(sentences), (value) =>
    arrayField(value, "chunks"),
  );
  return validateCandidates(items, sentences, ignored);
}

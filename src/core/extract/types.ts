export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 对 AI 服务的最小抽象：应用内走 Rust 转发，评测脚本和测试各有自己的实现 */
export interface AiClient {
  chat(messages: ChatMessage[], options: { json: boolean }): Promise<string>;
}

/** 送去抽取的句子 */
export interface SourceSentence {
  /** 全文内的句子编号 */
  idx: number;
  paragraphIdx: number;
  text: string;
}

/** 通过规则校验的句块候选 */
export interface Candidate {
  sentenceIdx: number;
  /** 原文形式：取自原句本身，不使用 AI 返回的文字 */
  surface: string;
  /** 原文形式在句子中的起始下标 */
  start: number;
  lemma: string;
  lemmaKey: string;
  meaning: string;
}

export type RejectReason =
  /** 条目缺字段或类型不对 */
  | "malformed"
  /** 句子编号不在这一批里 */
  | "bad-sentence"
  /** 原文形式没有逐字出现在对应句子中 */
  | "not-verbatim"
  /** 长度不在 2–8 个词之间 */
  | "length"
  /** 原形在忽略名单中 */
  | "ignored"
  /** 同一句里重复的原形 */
  | "duplicate";

export interface Rejected {
  reason: RejectReason;
  raw: unknown;
}

/** AI 返回的内容无法解析成约定的格式 */
export class AiFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiFormatError";
  }
}

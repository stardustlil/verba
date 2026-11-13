import { AiFormatError } from "./types";

/**
 * 从 AI 的输出中取出 JSON。优先按纯 JSON 解析；
 * 有些兼容接口不支持 JSON 模式，会在前后带说明文字或代码围栏，这里做兜底。
 */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const attempts: string[] = [trimmed];

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) attempts.push(fenced[1].trim());

  for (const [open, close] of [
    ["{", "}"],
    ["[", "]"],
  ] as const) {
    const start = trimmed.indexOf(open);
    const end = trimmed.lastIndexOf(close);
    if (start >= 0 && end > start) attempts.push(trimmed.slice(start, end + 1));
  }

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt) as unknown;
    } catch {
      // 换下一种取法
    }
  }
  throw new AiFormatError("AI 返回的内容不是 JSON");
}

/** 取出约定字段下的数组；AI 直接返回数组时也接受 */
export function arrayField(value: unknown, field: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && value !== null) {
    const inner = (value as Record<string, unknown>)[field];
    if (Array.isArray(inner)) return inner;
  }
  throw new AiFormatError(`AI 返回的 JSON 中没有 ${field} 数组`);
}

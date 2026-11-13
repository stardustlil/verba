/**
 * 义项判断（需求 3.3 第 4 步）：抽取出的句块若原形与库中已有句块相同，
 * 让 AI 判断是“同一义项”还是“新义项”，结果用于去重（需求 3.6）。
 */
import { arrayField } from "./parse";
import { chatJson } from "./pipeline";
import { AiFormatError, type AiClient, type ChatMessage } from "./types";

export interface ExistingSense {
  meaning: string;
  /** 该义项的一个例句，帮助 AI 判断 */
  example?: string;
}

export interface SenseQuery {
  lemma: string;
  meaning: string;
  sentence: string;
  /** 库中原形相同的全部义项 */
  existing: ExistingSense[];
}

export const SENSE_SYSTEM_PROMPT = `你在帮助整理一个英语句块库。库里同一个英文句块可能有多个意思不同的“义项”。
对每一条“新句块”，判断它和库中的哪一个“已有义项”是同一个意思。

判断标准：
- 同一义项：意思相同，只是中文措辞不同，如“引起注意”与“吸引关注”
- 新义项：意思明显不同，如 run into 的“偶然遇到”与“撞上”

只输出 JSON，格式如下：
{"results":[{"id":1,"match":2}]}
- id 是新句块的编号
- match 是与它同一义项的已有义项的序号；和所有已有义项都不同时写 0
- 每一条新句块都必须给出结果`;

export function buildSenseMessages(queries: SenseQuery[]): ChatMessage[] {
  const blocks = queries.map((query, i) => {
    const existing = query.existing
      .map((sense, n) => {
        const example = sense.example ? `（例句：${sense.example}）` : "";
        return `  ${n + 1}. ${sense.meaning}${example}`;
      })
      .join("\n");
    return [
      `#${i + 1} ${query.lemma}`,
      `新句块：${query.meaning}（例句：${query.sentence}）`,
      "已有义项：",
      existing,
    ].join("\n");
  });
  return [
    { role: "system", content: SENSE_SYSTEM_PROMPT },
    { role: "user", content: `请判断下面每条新句块的义项，输出 JSON。\n\n${blocks.join("\n\n")}` },
  ];
}

/**
 * 解析义项判断结果。返回与 queries 等长的数组：
 * 0 表示新义项，n 表示与第 n 个已有义项相同（从 1 开始）。
 */
export function parseSenseResults(value: unknown, queries: SenseQuery[]): number[] {
  const results = new Array<number | undefined>(queries.length).fill(undefined);
  for (const raw of arrayField(value, "results")) {
    const item = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const id = item.id;
    const match = item.match;
    if (typeof id !== "number" || typeof match !== "number") continue;
    const query = queries[id - 1];
    if (!query || !Number.isInteger(match) || match < 0 || match > query.existing.length) continue;
    results[id - 1] = match;
  }
  if (results.some((r) => r === undefined)) {
    throw new AiFormatError("AI 的义项判断结果不完整");
  }
  return results as number[];
}

export async function judgeSenses(ai: AiClient, queries: SenseQuery[]): Promise<number[]> {
  if (queries.length === 0) return [];
  return chatJson(ai, buildSenseMessages(queries), (value) => parseSenseResults(value, queries));
}

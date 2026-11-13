/**
 * 用真实的 AI 接口评测句块抽取效果。
 *
 *   npm run eval:extract              评测 eval/articles 下的全部 .txt / .md
 *   npm run eval:extract -- 01 03     只评测文件名包含这些字样的文章
 *
 * 环境变量：DEEPSEEK_API_KEY（必填），VERBA_AI_BASE_URL、VERBA_AI_MODEL（可选）。
 * 走的是和应用完全相同的流程：清理 → 分句 → 分批 → 抽取 → 规则校验。
 * 报告写到 eval/out/report.md。
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_AI_BASE_URL, DEFAULT_AI_MODEL } from "../src/core/extract/defaults";
import { extractBatch, makeBatches } from "../src/core/extract/pipeline";
import { type SenseQuery, judgeSenses } from "../src/core/extract/sense";
import type { AiClient, Candidate, ChatMessage, Rejected } from "../src/core/extract/types";
import { countWords } from "../src/core/judge/normalize";
import { cleanText } from "../src/core/text/clean";
import { stripMarkdown } from "../src/core/text/markdown";
import { type Sentence, segmentSentences } from "../src/core/text/segment";

const root = fileURLToPath(new URL("..", import.meta.url));
const articlesDir = join(root, "eval", "articles");
const outDir = join(root, "eval", "out");

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error("请先设置环境变量 DEEPSEEK_API_KEY");
  process.exit(1);
}
const baseUrl = (process.env.VERBA_AI_BASE_URL ?? DEFAULT_AI_BASE_URL).replace(/\/+$/, "");
const model = process.env.VERBA_AI_MODEL ?? DEFAULT_AI_MODEL;

const usage = { calls: 0, promptTokens: 0, completionTokens: 0 };

const ai: AiClient = {
  async chat(messages: ChatMessage[], options: { json: boolean }): Promise<string> {
    const body: Record<string, unknown> = { model, messages, temperature: 0, stream: false };
    if (options.json) body.response_format = { type: "json_object" };
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`AI 服务返回错误 ${response.status}：${text.slice(0, 300)}`);
    const data = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    usage.calls++;
    usage.promptTokens += data.usage?.prompt_tokens ?? 0;
    usage.completionTokens += data.usage?.completion_tokens ?? 0;
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("AI 服务的响应中没有内容");
    return content;
  },
};

interface ArticleResult {
  file: string;
  words: number;
  sentences: Sentence[];
  batches: number;
  failedBatches: string[];
  joins: string[];
  candidates: Candidate[];
  rejected: Rejected[];
  seconds: number;
}

async function evaluateArticle(path: string): Promise<ArticleResult> {
  const started = Date.now();
  const raw = readFileSync(path, "utf8");
  const cleaned = path.endsWith(".md") ? cleanText(stripMarkdown(raw), "join") : cleanText(raw);
  const sentences = segmentSentences(cleaned.text);
  const batches = makeBatches(sentences);

  const candidates: Candidate[] = [];
  const rejected: Rejected[] = [];
  const failedBatches: string[] = [];
  await Promise.all(
    batches.map(async (batch) => {
      try {
        const result = await extractBatch(ai, batch);
        candidates.push(...result.candidates);
        rejected.push(...result.rejected);
      } catch (error) {
        const range = `${batch[0]?.idx}–${batch.at(-1)?.idx}`;
        failedBatches.push(
          `句子 ${range}：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );
  candidates.sort((a, b) => a.sentenceIdx - b.sentenceIdx || a.start - b.start);

  return {
    file: basename(path),
    words: countWords(cleaned.text),
    sentences,
    batches: batches.length,
    failedBatches,
    joins: cleaned.joins.map((j) => j.word),
    candidates,
    rejected,
    seconds: (Date.now() - started) / 1000,
  };
}

/** 义项判断的固定用例：expected 为 0 表示应判为新义项 */
const SENSE_CASES: Array<SenseQuery & { expected: number }> = [
  {
    lemma: "run into",
    meaning: "偶然遇到",
    sentence: "I ran into an old friend at the airport.",
    existing: [{ meaning: "撞上", example: "The truck ran into a wall." }],
    expected: 0,
  },
  {
    lemma: "draw attention",
    meaning: "吸引关注",
    sentence: "The report drew attention to the housing shortage.",
    existing: [{ meaning: "引起注意", example: "Her speech drew attention from the press." }],
    expected: 1,
  },
  {
    lemma: "make up",
    meaning: "编造",
    sentence: "He made up an excuse for being late.",
    existing: [
      { meaning: "和好", example: "They argued but soon made up." },
      { meaning: "构成", example: "Women make up half of the workforce." },
    ],
    expected: 0,
  },
  {
    lemma: "make up",
    meaning: "组成",
    sentence: "Students make up most of the audience.",
    existing: [
      { meaning: "和好", example: "They argued but soon made up." },
      { meaning: "构成", example: "Women make up half of the workforce." },
    ],
    expected: 2,
  },
  {
    lemma: "pick up",
    meaning: "学会",
    sentence: "She picked up some French while living in Paris.",
    existing: [
      { meaning: "接（人）", example: "I'll pick up the kids after school." },
      { meaning: "捡起", example: "He picked up the coin." },
      { meaning: "不费力地学到", example: "Children pick up languages quickly." },
    ],
    expected: 3,
  },
  {
    lemma: "take off",
    meaning: "起飞",
    sentence: "The plane took off an hour late.",
    existing: [
      { meaning: "脱下", example: "Please take off your shoes." },
      { meaning: "突然走红", example: "Her career took off after the film." },
    ],
    expected: 0,
  },
  {
    lemma: "in the long run",
    meaning: "从长远来看",
    sentence: "In the long run, the investment will pay off.",
    existing: [{ meaning: "长期而言", example: "Cheap shoes cost more in the long run." }],
    expected: 1,
  },
];

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function renderArticle(result: ArticleResult): string {
  const lines: string[] = [];
  const perHundred = ((result.candidates.length / Math.max(result.words, 1)) * 100).toFixed(1);
  lines.push(`## ${result.file}`, "");
  lines.push(
    `${result.words} 词，${result.sentences.length} 句，${result.batches} 批，` +
      `抽出 **${result.candidates.length}** 个句块（每百词 ${perHundred} 个），` +
      `校验丢弃 ${result.rejected.length} 条，用时 ${result.seconds.toFixed(1)} 秒`,
    "",
  );
  if (result.joins.length > 0) {
    lines.push(`自动合并的断词：${result.joins.map((w) => `\`${w}\``).join("、")}`, "");
  }
  for (const failure of result.failedBatches) lines.push(`> 批次失败：${failure}`, "");

  const lemmaMismatch = result.candidates.filter(
    (c) => countWords(c.lemma) !== countWords(c.surface),
  );

  for (const sentence of result.sentences) {
    const found = result.candidates.filter((c) => c.sentenceIdx === sentence.idx);
    lines.push(`**[${sentence.idx}]** ${sentence.text}`, "");
    for (const c of found) {
      const same = c.surface.toLowerCase() === c.lemma.toLowerCase();
      const form = same ? `\`${c.surface}\`` : `\`${c.surface}\` → \`${c.lemma}\``;
      lines.push(`- ${form}：${c.meaning}`);
    }
    if (found.length > 0) lines.push("");
  }

  if (result.rejected.length > 0) {
    lines.push("### 被规则校验丢弃的条目", "", "| 原因 | AI 返回的内容 |", "|---|---|");
    for (const r of result.rejected) {
      lines.push(`| ${r.reason} | ${escapeCell(JSON.stringify(r.raw))} |`);
    }
    lines.push("");
  }
  if (lemmaMismatch.length > 0) {
    lines.push("### 原形与原文形式词数不同（供检查）", "");
    for (const c of lemmaMismatch) lines.push(`- \`${c.surface}\` → \`${c.lemma}\``);
    lines.push("");
  }
  return lines.join("\n");
}

async function evaluateSenses(): Promise<string> {
  const lines = ["## 义项判断", ""];
  let results: number[];
  try {
    results = await judgeSenses(ai, SENSE_CASES);
  } catch (error) {
    return [
      ...lines,
      `调用失败：${error instanceof Error ? error.message : String(error)}`,
      "",
    ].join("\n");
  }
  const describe = (c: SenseQuery, match: number) =>
    match === 0 ? "新义项" : `同「${c.existing[match - 1]?.meaning ?? "?"}」`;
  let passed = 0;
  lines.push("| 句块 | 新释义 | 已有义项 | 期望 | AI 判断 | |", "|---|---|---|---|---|---|");
  SENSE_CASES.forEach((c, i) => {
    const actual = results[i] ?? -1;
    const ok = actual === c.expected;
    if (ok) passed++;
    lines.push(
      `| ${c.lemma} | ${c.meaning} | ${c.existing.map((e) => e.meaning).join(" / ")} | ` +
        `${describe(c, c.expected)} | ${describe(c, actual)} | ${ok ? "✓" : "✗"} |`,
    );
  });
  lines.push("", `${passed} / ${SENSE_CASES.length} 与期望一致`, "");
  return lines.join("\n");
}

async function main() {
  const filters = process.argv.slice(2);
  const files = readdirSync(articlesDir)
    .filter((f) => /\.(txt|md)$/.test(f))
    .filter((f) => filters.length === 0 || filters.some((x) => f.includes(x)))
    .sort();
  if (files.length === 0) {
    console.error(`在 ${articlesDir} 下没有找到要评测的文章`);
    process.exit(1);
  }

  console.log(`模型 ${model}，共 ${files.length} 篇文章……`);
  const results = await Promise.all(files.map((f) => evaluateArticle(join(articlesDir, f))));
  const senses = await evaluateSenses();

  const totalChunks = results.reduce((n, r) => n + r.candidates.length, 0);
  const totalRejected = results.reduce((n, r) => n + r.rejected.length, 0);
  const totalWords = results.reduce((n, r) => n + r.words, 0);
  const header = [
    "# 句块抽取评测报告",
    "",
    `- 模型：${model}（${baseUrl}）`,
    `- 文章：${files.length} 篇，共 ${totalWords} 词`,
    `- 句块：${totalChunks} 个，校验丢弃 ${totalRejected} 条`,
    `- 调用：${usage.calls} 次，输入 ${usage.promptTokens} tokens，输出 ${usage.completionTokens} tokens`,
    "",
  ].join("\n");

  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, "report.md");
  writeFileSync(reportPath, [header, ...results.map(renderArticle), senses].join("\n"));

  for (const r of results) {
    console.log(
      `${r.file}：${r.candidates.length} 个句块，丢弃 ${r.rejected.length} 条` +
        (r.failedBatches.length > 0 ? `，${r.failedBatches.length} 批失败` : ""),
    );
  }
  console.log(`报告已写入 ${reportPath}`);
}

await main();

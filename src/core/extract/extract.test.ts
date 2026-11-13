import { describe, expect, it } from "vitest";
import { segmentSentences } from "../text/segment";
import { parseJsonLoose } from "./parse";
import { extractBatch, makeBatches } from "./pipeline";
import { buildExtractMessages } from "./prompt";
import { buildSenseMessages, judgeSenses } from "./sense";
import { AiFormatError, type AiClient, type SourceSentence } from "./types";
import { locateSurface, validateCandidates } from "./validate";

const sentence = (idx: number, text: string, paragraphIdx = 0): SourceSentence => ({
  idx,
  paragraphIdx,
  text,
});

/** 依次返回预设回答的假 AI */
function fakeAi(replies: Array<string | Error>): AiClient & { calls: number } {
  const client = {
    calls: 0,
    async chat() {
      const reply = replies[client.calls++];
      if (reply === undefined) throw new Error("没有更多预设回答");
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  return client;
}

const S1 = "The new policy has drawn widespread attention from both experts and the public.";
const S2 = "In the wake of the crisis, he finally made up his mind.";

describe("parseJsonLoose", () => {
  it("纯 JSON", () => {
    expect(parseJsonLoose('{"chunks":[]}')).toEqual({ chunks: [] });
  });
  it("带代码围栏或前后说明文字", () => {
    expect(parseJsonLoose('```json\n{"chunks":[1]}\n```')).toEqual({ chunks: [1] });
    expect(parseJsonLoose('好的，结果如下：\n{"chunks":[2]}\n希望有帮助')).toEqual({ chunks: [2] });
    expect(parseJsonLoose("结果：[1, 2]")).toEqual([1, 2]);
  });
  it("不是 JSON 时抛出格式错误", () => {
    expect(() => parseJsonLoose("抱歉，我无法完成")).toThrow(AiFormatError);
  });
});

describe("locateSurface", () => {
  it("逐字出现时返回位置", () => {
    const span = locateSurface(S1, "drawn widespread attention");
    expect(span && S1.slice(span.start, span.end)).toBe("drawn widespread attention");
  });
  it("忽略大小写，取原句中的写法", () => {
    const span = locateSurface(S2, "in the wake of");
    expect(span && S2.slice(span.start, span.end)).toBe("In the wake of");
  });
  it("忽略引号写法的差异", () => {
    const text = "It’s the company’s future that is at stake.";
    const span = locateSurface(text, "the company's future");
    expect(span && text.slice(span.start, span.end)).toBe("the company’s future");
  });
  it("去掉 AI 多带的首尾标点", () => {
    const span = locateSurface(S2, '"made up his mind."');
    expect(span && S2.slice(span.start, span.end)).toBe("made up his mind");
  });
  it("被改写或编造的不匹配", () => {
    expect(locateSurface(S1, "draw widespread attention")).toBeNull();
    expect(locateSurface(S1, "attracted wide attention")).toBeNull();
  });
  it("中间被隔开的不匹配", () => {
    expect(
      locateSurface("We must take these factors into account.", "take into account"),
    ).toBeNull();
  });
  it("必须是完整的词", () => {
    expect(locateSurface("They overdrawn attention spans.", "drawn attention")).toBeNull();
    expect(locateSurface("A long-term goal matters.", "term goal")).toBeNull();
    expect(locateSurface("The plan pays off.", "plan pay")).toBeNull();
  });
  it("前一处不是完整的词时继续往后找", () => {
    const text = "Overdrawn accounts have drawn attention.";
    const span = locateSurface(text, "drawn attention");
    expect(span?.start).toBe(text.lastIndexOf("drawn attention"));
  });
});

describe("validateCandidates", () => {
  const sentences = [sentence(10, S1), sentence(11, S2)];

  it("通过校验的条目取原句文字作为原文形式", () => {
    const { candidates, rejected } = validateCandidates(
      [
        {
          s: 1,
          text: "drawn widespread attention",
          lemma: "draw widespread attention",
          zh: "引起广泛关注",
        },
        { s: 2, text: "in the wake of", lemma: "in the wake of", zh: "在……之后" },
        { s: 2, text: "made up his mind", lemma: "Make up  one’s mind", zh: "下定决心" },
      ],
      sentences,
    );
    expect(rejected).toEqual([]);
    expect(candidates).toEqual([
      {
        sentenceIdx: 10,
        surface: "drawn widespread attention",
        start: S1.indexOf("drawn"),
        lemma: "draw widespread attention",
        lemmaKey: "draw widespread attention",
        meaning: "引起广泛关注",
      },
      {
        sentenceIdx: 11,
        surface: "In the wake of",
        start: 0,
        lemma: "in the wake of",
        lemmaKey: "in the wake of",
        meaning: "在……之后",
      },
      {
        sentenceIdx: 11,
        surface: "made up his mind",
        start: S2.indexOf("made"),
        lemma: "Make up one’s mind",
        lemmaKey: "make up one's mind",
        meaning: "下定决心",
      },
    ]);
  });

  it("丢弃不合格的条目并记录原因", () => {
    const { candidates, rejected } = validateCandidates(
      [
        { s: 1, text: "attracted wide attention", lemma: "attract wide attention", zh: "吸引关注" },
        { s: 9, text: "the public", lemma: "the public", zh: "公众" },
        { s: 1, text: "policy", lemma: "policy", zh: "政策" },
        { s: 1, text: S1.slice(0, -1), lemma: S1.slice(0, -1), zh: "整句" },
        { s: 1, text: "the public", lemma: "the public" },
        { s: "1", text: "the public", lemma: "the public", zh: "公众" },
        "不是对象",
        { s: 2, text: "made up his mind", lemma: "make up one's mind", zh: "下定决心" },
        { s: 2, text: "made up his mind", lemma: "make up one's mind", zh: "拿定主意" },
      ],
      sentences,
    );
    expect(rejected.map((r) => r.reason)).toEqual([
      "not-verbatim",
      "bad-sentence",
      "length",
      "length",
      "malformed",
      "malformed",
      "malformed",
      "duplicate",
    ]);
    expect(candidates.map((c) => c.lemmaKey)).toEqual(["make up one's mind"]);
  });

  it("原形在忽略名单中的丢弃", () => {
    const { candidates, rejected } = validateCandidates(
      [{ s: 2, text: "made up his mind", lemma: "make up one's mind", zh: "下定决心" }],
      sentences,
      new Set(["make up one's mind"]),
    );
    expect(candidates).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual(["ignored"]);
  });
});

describe("makeBatches", () => {
  const article = [
    "Para one sentence one. Para one sentence two.",
    "Para two sentence one.",
    "Para three sentence one. Para three sentence two. Para three sentence three.",
  ].join("\n\n");
  const all = segmentSentences(article);

  it("不超过上限时合为一批", () => {
    expect(makeBatches(all, 1000)).toHaveLength(1);
  });

  it("按段落分批，不拆开段落", () => {
    const batches = makeBatches(all, 60);
    expect(batches.map((b) => b.map((s) => s.idx))).toEqual([[0, 1], [2], [3, 4, 5]]);
  });

  it("只选了不相邻的段落时分开成批", () => {
    const selected = all.filter((s) => s.paragraphIdx !== 1);
    const batches = makeBatches(selected, 1000);
    expect(batches.map((b) => b.map((s) => s.idx))).toEqual([
      [0, 1],
      [3, 4, 5],
    ]);
  });

  it("单个超长段落按句子拆开", () => {
    const long = segmentSentences(
      Array.from({ length: 10 }, (_, i) => `This is sentence number ${i} of the paragraph.`).join(
        " ",
      ),
    );
    const batches = makeBatches(long, 100);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat().map((s) => s.idx)).toEqual(long.map((s) => s.idx));
  });

  it("没有句子时没有批次", () => {
    expect(makeBatches([])).toEqual([]);
  });
});

describe("extractBatch", () => {
  const sentences = [sentence(0, S1), sentence(1, S2)];
  const good = JSON.stringify({
    chunks: [
      {
        s: 1,
        text: "drawn widespread attention",
        lemma: "draw widespread attention",
        zh: "引起广泛关注",
      },
    ],
  });

  it("句子按批内序号编号后发给 AI", () => {
    const messages = buildExtractMessages(sentences);
    expect(messages[1]?.content).toContain(`[1] ${S1}\n[2] ${S2}`);
  });

  it("解析并校验 AI 的结果", async () => {
    const ai = fakeAi([good]);
    const result = await extractBatch(ai, sentences);
    expect(result.candidates.map((c) => c.lemma)).toEqual(["draw widespread attention"]);
    expect(ai.calls).toBe(1);
  });

  it("没有句块时返回空", async () => {
    const result = await extractBatch(fakeAi(['{"chunks":[]}']), sentences);
    expect(result).toEqual({ candidates: [], rejected: [] });
  });

  it("格式不正确时重试一次", async () => {
    const ai = fakeAi(["抱歉，出错了", good]);
    const result = await extractBatch(ai, sentences);
    expect(result.candidates).toHaveLength(1);
    expect(ai.calls).toBe(2);
  });

  it("重试后仍然格式不正确则失败", async () => {
    const ai = fakeAi(["不是 JSON", '{"items":[]}']);
    await expect(extractBatch(ai, sentences)).rejects.toBeInstanceOf(AiFormatError);
    expect(ai.calls).toBe(2);
  });

  it("网络错误不重试，直接失败", async () => {
    const ai = fakeAi([new Error("network down"), good]);
    await expect(extractBatch(ai, sentences)).rejects.toThrow("network down");
    expect(ai.calls).toBe(1);
  });
});

describe("义项判断", () => {
  const queries = [
    {
      lemma: "run into",
      meaning: "偶然遇到",
      sentence: "I ran into an old friend yesterday.",
      existing: [
        { meaning: "撞上", example: "The car ran into a tree." },
        { meaning: "遇到（困难）" },
      ],
    },
    {
      lemma: "draw attention",
      meaning: "吸引关注",
      sentence: "The report drew attention to the problem.",
      existing: [{ meaning: "引起注意" }],
    },
  ];

  it("把新句块和已有义项一起发给 AI", () => {
    const content = buildSenseMessages(queries)[1]?.content ?? "";
    expect(content).toContain("#1 run into");
    expect(content).toContain("1. 撞上（例句：The car ran into a tree.）");
    expect(content).toContain("2. 遇到（困难）");
    expect(content).toContain("#2 draw attention");
  });

  it("返回每条的匹配序号，0 表示新义项", async () => {
    const ai = fakeAi(['{"results":[{"id":2,"match":1},{"id":1,"match":0}]}']);
    expect(await judgeSenses(ai, queries)).toEqual([0, 1]);
  });

  it("结果不完整或序号越界时重试，仍不行则失败", async () => {
    const ai = fakeAi([
      '{"results":[{"id":1,"match":0}]}',
      '{"results":[{"id":1,"match":3},{"id":2,"match":1}]}',
    ]);
    await expect(judgeSenses(ai, queries)).rejects.toBeInstanceOf(AiFormatError);
    expect(ai.calls).toBe(2);
  });

  it("没有需要判断的条目时不调用 AI", async () => {
    const ai = fakeAi([]);
    expect(await judgeSenses(ai, [])).toEqual([]);
    expect(ai.calls).toBe(0);
  });
});

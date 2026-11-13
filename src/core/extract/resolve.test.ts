import { describe, expect, it } from "vitest";
import { type LibrarySense, type Resolution, resolveCandidates } from "./resolve";
import type { AiClient, Candidate } from "./types";

const SENTENCES = [
  "I ran into an old friend at the airport.",
  "The truck ran into a wall.",
  "She ran into her teacher at the market.",
  "Heavy rain fell all night.",
  "He ran into trouble with the law.",
];

function candidate(sentenceIdx: number, lemma: string, meaning: string): Candidate {
  return { sentenceIdx, surface: lemma, start: 0, lemma, lemmaKey: lemma.toLowerCase(), meaning };
}

/** 按预设依次回答义项判断；每个回答是与各条查询对应的 match 数组 */
function senseAi(answers: number[][]): AiClient & { prompts: string[] } {
  const client = {
    prompts: [] as string[],
    async chat(messages: Array<{ content: string }>) {
      client.prompts.push(messages[1]?.content ?? "");
      const matches = answers[client.prompts.length - 1];
      if (!matches) throw new Error("没有更多预设回答");
      return JSON.stringify({ results: matches.map((match, i) => ({ id: i + 1, match })) });
    },
  };
  return client;
}

function ids(): () => string {
  let n = 0;
  return () => `new-${++n}`;
}

async function resolve(
  ai: AiClient,
  candidates: Candidate[],
  library: Record<string, LibrarySense[]> = {},
): Promise<Resolution[]> {
  return resolveCandidates(ai, {
    candidates,
    sentenceText: (idx) => SENTENCES[idx] ?? "",
    library: new Map(Object.entries(library)),
    newId: ids(),
  });
}

const brief = (r: Resolution) =>
  r.kind === "skip" ? `skip:${r.reason}` : `${r.kind}:${r.chunkId}`;

describe("resolveCandidates", () => {
  it("库中没有相同原形时直接新建，不调用 AI", async () => {
    const ai = senseAi([]);
    const result = await resolve(ai, [
      candidate(0, "run into", "偶然遇到"),
      candidate(3, "heavy rain", "大雨"),
    ]);
    expect(result.map(brief)).toEqual(["new:new-1", "new:new-2"]);
    expect(ai.prompts).toHaveLength(0);
  });

  it("原形相同且 AI 判为同一义项：并入已有句块作为例句", async () => {
    const ai = senseAi([[1]]);
    const result = await resolve(ai, [candidate(2, "run into", "碰见")], {
      "run into": [{ chunkId: "c1", meaning: "偶然遇到", exampleSentences: [SENTENCES[0]!] }],
    });
    expect(result.map(brief)).toEqual(["merge:c1"]);
    expect(ai.prompts[0]).toContain(
      "1. 偶然遇到（例句：I ran into an old friend at the airport.）",
    );
  });

  it("原形相同但 AI 判为新义项：新建句块", async () => {
    const ai = senseAi([[0]]);
    const result = await resolve(ai, [candidate(1, "run into", "撞上")], {
      "run into": [{ chunkId: "c1", meaning: "偶然遇到", exampleSentences: [SENTENCES[0]!] }],
    });
    expect(result.map(brief)).toEqual(["new:new-1"]);
  });

  it("已有多个义项时并入 AI 选中的那一个", async () => {
    const ai = senseAi([[2]]);
    const result = await resolve(ai, [candidate(2, "run into", "碰见")], {
      "run into": [
        { chunkId: "c1", meaning: "撞上", exampleSentences: [SENTENCES[1]!] },
        { chunkId: "c2", meaning: "偶然遇到", exampleSentences: [SENTENCES[0]!] },
      ],
    });
    expect(result.map(brief)).toEqual(["merge:c2"]);
  });

  it("同一个句子已经是该句块的例句时不重复添加", async () => {
    const ai = senseAi([[1]]);
    const result = await resolve(ai, [candidate(0, "run into", "偶然遇到")], {
      "run into": [
        {
          chunkId: "c1",
          meaning: "偶然遇到",
          exampleSentences: ["  i ran into an old friend at the  airport. "],
        },
      ],
    });
    expect(result.map(brief)).toEqual(["skip:same-sentence"]);
  });

  it("例句已满 5 个时不再添加", async () => {
    const ai = senseAi([[1]]);
    const result = await resolve(ai, [candidate(2, "run into", "碰见")], {
      "run into": [
        { chunkId: "c1", meaning: "偶然遇到", exampleSentences: ["a.", "b.", "c.", "d.", "e."] },
      ],
    });
    expect(result.map(brief)).toEqual(["skip:examples-full"]);
  });

  it("同一批里原形相同：后一个与前一个刚建的义项比较", async () => {
    // 第一轮没有需要判断的；第二轮判断第二个候选（同一义项）
    const ai = senseAi([[1]]);
    const result = await resolve(ai, [
      candidate(0, "run into", "偶然遇到"),
      candidate(2, "run into", "碰见"),
    ]);
    expect(result.map(brief)).toEqual(["new:new-1", "merge:new-1"]);
    expect(ai.prompts).toHaveLength(1);
  });

  it("同一批里出现三个原形相同、义项各异的候选", async () => {
    const ai = senseAi([[0], [0]]);
    const result = await resolve(ai, [
      candidate(0, "run into", "偶然遇到"),
      candidate(1, "run into", "撞上"),
      candidate(4, "run into", "陷入（麻烦）"),
    ]);
    expect(result.map(brief)).toEqual(["new:new-1", "new:new-2", "new:new-3"]);
    // 第三个候选要同时与前两个义项比较
    expect(ai.prompts[1]).toContain("1. 偶然遇到");
    expect(ai.prompts[1]).toContain("2. 撞上");
  });

  it("并入后计入例句数：同一批里超过上限的被跳过", async () => {
    const ai = senseAi([[1], [1]]);
    const result = await resolve(
      ai,
      [candidate(0, "run into", "偶然遇到"), candidate(2, "run into", "碰见")],
      {
        "run into": [
          { chunkId: "c1", meaning: "偶遇", exampleSentences: ["a.", "b.", "c.", "d."] },
        ],
      },
    );
    expect(result.map(brief)).toEqual(["merge:c1", "skip:examples-full"]);
  });

  it("不修改传入的库数据", async () => {
    const library = { "run into": [{ chunkId: "c1", meaning: "偶遇", exampleSentences: ["a."] }] };
    await resolve(senseAi([[1]]), [candidate(0, "run into", "偶然遇到")], library);
    expect(library["run into"][0]?.exampleSentences).toEqual(["a."]);
  });

  it("义项判断失败时整体失败，由调用方按批次失败处理", async () => {
    const ai: AiClient = {
      async chat() {
        throw new Error("network down");
      },
    };
    await expect(
      resolve(ai, [candidate(2, "run into", "碰见")], {
        "run into": [{ chunkId: "c1", meaning: "偶遇", exampleSentences: [] }],
      }),
    ).rejects.toThrow("network down");
  });
});

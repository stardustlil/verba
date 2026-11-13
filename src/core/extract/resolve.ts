/**
 * 重复句块的处理（需求 3.6）：决定每个候选是新建句块、并入已有句块作为例句，还是跳过。
 * 原形相同时由 AI 判断是否为同一义项（需求 3.3 第 4 步），其余全部是确定的规则。
 */
import { type SenseQuery, judgeSenses } from "./sense";
import type { AiClient, Candidate } from "./types";

/** 每个句块最多保留的例句数 */
export const MAX_EXAMPLES = 5;

/** 库中已有的一个义项（即一个句块） */
export interface LibrarySense {
  chunkId: string;
  meaning: string;
  /** 已有例句的原句文本 */
  exampleSentences: string[];
}

export type Resolution =
  /** 新建句块，候选所在的句子作为它的第一个例句 */
  | { kind: "new"; candidate: Candidate; chunkId: string }
  /** 并入已有句块，作为新例句；已有句块的释义和学习进度不变 */
  | { kind: "merge"; candidate: Candidate; chunkId: string }
  | { kind: "skip"; candidate: Candidate; reason: "same-sentence" | "examples-full" };

export interface ResolveInput {
  candidates: Candidate[];
  /** 候选所在句子的原文 */
  sentenceText: (sentenceIdx: number) => string;
  /** 库中原形相同的全部义项，按原形去重键索引 */
  library: ReadonlyMap<string, LibrarySense[]>;
  newId: () => string;
}

function sameSentence(a: string, b: string): boolean {
  const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return normalize(a) === normalize(b);
}

export async function resolveCandidates(ai: AiClient, input: ResolveInput): Promise<Resolution[]> {
  const { candidates, sentenceText, newId } = input;
  /** 工作副本：随着本批的新建和合并而更新 */
  const senses = new Map<string, LibrarySense[]>();
  for (const [key, list] of input.library) {
    senses.set(
      key,
      list.map((s) => ({ ...s, exampleSentences: [...s.exampleSentences] })),
    );
  }
  const resolved = new Map<Candidate, Resolution>();

  const mergeInto = (candidate: Candidate, sense: LibrarySense) => {
    const sentence = sentenceText(candidate.sentenceIdx);
    if (sense.exampleSentences.some((existing) => sameSentence(existing, sentence))) {
      resolved.set(candidate, { kind: "skip", candidate, reason: "same-sentence" });
    } else if (sense.exampleSentences.length >= MAX_EXAMPLES) {
      resolved.set(candidate, { kind: "skip", candidate, reason: "examples-full" });
    } else {
      sense.exampleSentences.push(sentence);
      resolved.set(candidate, { kind: "merge", candidate, chunkId: sense.chunkId });
    }
  };

  const createNew = (candidate: Candidate) => {
    const sense: LibrarySense = {
      chunkId: newId(),
      meaning: candidate.meaning,
      exampleSentences: [sentenceText(candidate.sentenceIdx)],
    };
    senses.set(candidate.lemmaKey, [...(senses.get(candidate.lemmaKey) ?? []), sense]);
    resolved.set(candidate, { kind: "new", candidate, chunkId: sense.chunkId });
  };

  // 每一轮：每个原形只处理排在最前面的一个未决候选，这样同一批里原形相同的
  // 后一个候选能与前一个刚建好的义项比较。绝大多数情况下只有一轮。
  let pending = [...candidates];
  while (pending.length > 0) {
    const round: Candidate[] = [];
    const later: Candidate[] = [];
    const taken = new Set<string>();
    for (const candidate of pending) {
      if (taken.has(candidate.lemmaKey)) {
        later.push(candidate);
      } else {
        taken.add(candidate.lemmaKey);
        round.push(candidate);
      }
    }

    const needJudging: Array<{ candidate: Candidate; existing: LibrarySense[] }> = [];
    for (const candidate of round) {
      const existing = senses.get(candidate.lemmaKey) ?? [];
      if (existing.length === 0) createNew(candidate);
      else needJudging.push({ candidate, existing: [...existing] });
    }

    if (needJudging.length > 0) {
      const queries: SenseQuery[] = needJudging.map(({ candidate, existing }) => ({
        lemma: candidate.lemma,
        meaning: candidate.meaning,
        sentence: sentenceText(candidate.sentenceIdx),
        existing: existing.map((s) => ({ meaning: s.meaning, example: s.exampleSentences[0] })),
      }));
      const matches = await judgeSenses(ai, queries);
      needJudging.forEach(({ candidate, existing }, i) => {
        const match = matches[i] ?? 0;
        const sense = match > 0 ? existing[match - 1] : undefined;
        if (sense) mergeInto(candidate, sense);
        else createNew(candidate);
      });
    }
    pending = later;
  }

  return candidates.map((candidate) => {
    const resolution = resolved.get(candidate);
    if (!resolution) throw new Error("候选未被处理");
    return resolution;
  });
}

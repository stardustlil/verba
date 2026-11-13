/**
 * 答错时的结果展示（需求 5.4）：逐词标出对错，错词内标出具体错在哪个字母。
 */
import { type Token, tokenMatches, variants } from "./judge";

export interface CharMark {
  ch: string;
  /** ok 正确；wrong 用户多写或写错的字母；missing 用户漏掉的字母（ch 为应有的字母） */
  kind: "ok" | "wrong" | "missing";
}

export type WordMark =
  | { kind: "ok"; text: string }
  | { kind: "wrong"; text: string; expected: string; chars: CharMark[] }
  | { kind: "extra"; text: string }
  | { kind: "missing"; expected: string };

type Step = "match" | "substitute" | "insert" | "delete";

interface Alignment {
  cost: number;
  steps: Step[];
}

/**
 * 通用的编辑距离对齐。insert 表示 actual 多出一项，delete 表示 expected 少了一项。
 */
function align<A, B>(
  expected: A[],
  actual: B[],
  substituteCost: (e: A, a: B) => number,
  gapCost: number,
): Alignment {
  const rows = expected.length + 1;
  const cols = actual.length + 1;
  const cost: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  const from: Step[][] = Array.from({ length: rows }, () => new Array<Step>(cols).fill("match"));

  for (let i = 1; i < rows; i++) {
    cost[i]![0] = i * gapCost;
    from[i]![0] = "delete";
  }
  for (let j = 1; j < cols; j++) {
    cost[0]![j] = j * gapCost;
    from[0]![j] = "insert";
  }
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const sub = substituteCost(expected[i - 1]!, actual[j - 1]!);
      const diagonal = cost[i - 1]![j - 1]! + sub;
      const up = cost[i - 1]![j]! + gapCost;
      const left = cost[i]![j - 1]! + gapCost;
      const best = Math.min(diagonal, up, left);
      cost[i]![j] = best;
      from[i]![j] =
        best === diagonal
          ? sub === 0
            ? "match"
            : "substitute"
          : best === up
            ? "delete"
            : "insert";
    }
  }

  const steps: Step[] = [];
  let i = expected.length;
  let j = actual.length;
  while (i > 0 || j > 0) {
    const step = from[i]![j]!;
    steps.push(step);
    if (step === "match" || step === "substitute") {
      i--;
      j--;
    } else if (step === "delete") {
      i--;
    } else {
      j--;
    }
  }
  steps.reverse();
  return { cost: cost[expected.length]![actual.length]!, steps };
}

function alignChars(expected: string, actual: string): Alignment {
  return align(
    [...expected],
    [...actual],
    (e, a) => (e.toLowerCase() === a.toLowerCase() ? 0 : 1),
    1,
  );
}

function diffChars(expected: string, actual: string): CharMark[] {
  const e = [...expected];
  const a = [...actual];
  const marks: CharMark[] = [];
  let i = 0;
  let j = 0;
  for (const step of alignChars(expected, actual).steps) {
    if (step === "match") {
      marks.push({ ch: a[j]!, kind: "ok" });
      i++;
      j++;
    } else if (step === "substitute") {
      marks.push({ ch: a[j]!, kind: "wrong" });
      i++;
      j++;
    } else if (step === "insert") {
      marks.push({ ch: a[j]!, kind: "wrong" });
      j++;
    } else {
      marks.push({ ch: e[i]!, kind: "missing" });
      i++;
    }
  }
  return marks;
}

/** 增删一个词的代价；低于“完全不同的两个词互相替换”的代价的两倍，使词序错误显示为一多一少 */
const WORD_GAP_COST = 0.8;

function alignWords(expected: Token[], actual: Token[], slots: boolean): Alignment {
  return align(
    expected,
    actual,
    (e, a) => {
      if (tokenMatches(e, a, slots)) return 0;
      const distance = alignChars(e.key, a.key).cost;
      return 0.5 + 0.5 * (distance / Math.max(e.key.length, a.key.length, 1));
    },
    WORD_GAP_COST,
  );
}

/**
 * 对比用户输入与正确答案。
 * 缩写与全写的差异不算错：两边都会先展开，再选最接近的一种写法来对比。
 */
export function diffAnswer(input: string, target: string, slots = false): WordMark[] {
  let best: { alignment: Alignment; expected: Token[]; actual: Token[] } | null = null;
  for (const expected of variants(target)) {
    for (const actual of variants(input)) {
      const alignment = alignWords(expected, actual, slots);
      if (best === null || alignment.cost < best.alignment.cost) {
        best = { alignment, expected, actual };
      }
    }
  }
  if (best === null) return [];

  const marks: WordMark[] = [];
  let i = 0;
  let j = 0;
  for (const step of best.alignment.steps) {
    const expected = best.expected[i];
    const actual = best.actual[j];
    if (step === "match" && actual) {
      marks.push({ kind: "ok", text: actual.display });
      i++;
      j++;
    } else if (step === "substitute" && expected && actual) {
      marks.push({
        kind: "wrong",
        text: actual.display,
        expected: expected.display,
        chars: diffChars(expected.display, actual.display),
      });
      i++;
      j++;
    } else if (step === "insert" && actual) {
      marks.push({ kind: "extra", text: actual.display });
      j++;
    } else if (step === "delete" && expected) {
      marks.push({ kind: "missing", expected: expected.display });
      i++;
    }
  }
  return marks;
}

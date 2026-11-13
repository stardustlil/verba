/**
 * 缩写与全写的对照（需求 5.4）。固定表，不做猜测：
 * 表里没有的写法（如所有格 John's）原样保留。
 * 有歧义的缩写给出全部可能的展开，任一种与答案一致即算对。
 */

const NEGATIONS: Record<string, string> = {
  "aren't": "are",
  "couldn't": "could",
  "didn't": "did",
  "doesn't": "does",
  "don't": "do",
  "hadn't": "had",
  "hasn't": "has",
  "haven't": "have",
  "isn't": "is",
  "mightn't": "might",
  "mustn't": "must",
  "needn't": "need",
  "shouldn't": "should",
  "wasn't": "was",
  "weren't": "were",
  "wouldn't": "would",
  "won't": "will",
  "shan't": "shall",
  "can't": "can",
  cannot: "can",
};

const SUBJECTS_WILL = [
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "that",
  "there",
  "who",
  "what",
  "this",
];
const SUBJECTS_WOULD_HAD = ["i", "you", "he", "she", "it", "we", "they", "that", "there", "who"];
const SUBJECTS_HAVE = [
  "i",
  "you",
  "we",
  "they",
  "who",
  "could",
  "should",
  "would",
  "might",
  "must",
];
const SUBJECTS_ARE = ["you", "we", "they", "who", "what", "there"];
const SUBJECTS_IS_HAS = [
  "it",
  "he",
  "she",
  "that",
  "there",
  "here",
  "what",
  "who",
  "where",
  "when",
  "how",
  "why",
];

function build(): Map<string, string[][]> {
  const table = new Map<string, string[][]>();
  for (const [short, verb] of Object.entries(NEGATIONS)) table.set(short, [[verb, "not"]]);
  table.set("ain't", [
    ["am", "not"],
    ["is", "not"],
    ["are", "not"],
    ["has", "not"],
    ["have", "not"],
  ]);
  table.set("i'm", [["i", "am"]]);
  table.set("let's", [["let", "us"]]);
  for (const s of SUBJECTS_WILL) table.set(`${s}'ll`, [[s, "will"]]);
  for (const s of SUBJECTS_HAVE) table.set(`${s}'ve`, [[s, "have"]]);
  for (const s of SUBJECTS_ARE) table.set(`${s}'re`, [[s, "are"]]);
  for (const s of SUBJECTS_WOULD_HAD) {
    table.set(`${s}'d`, [
      [s, "had"],
      [s, "would"],
    ]);
  }
  for (const s of SUBJECTS_IS_HAS) {
    table.set(`${s}'s`, [
      [s, "is"],
      [s, "has"],
    ]);
  }
  return table;
}

const TABLE = build();

/**
 * 返回一个词（小写、直引号）的全部展开方式。
 * 不是缩写时返回 null。
 */
export function expandContraction(token: string): string[][] | null {
  return TABLE.get(token) ?? null;
}

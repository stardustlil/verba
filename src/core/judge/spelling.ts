import data from "./spelling-data.json";

/**
 * 英式与美式拼写对照（需求 5.4），数据由 VarCon 生成，见 scripts/build-spelling.mjs。
 * 把一个词（小写）换成规范拼写；表里没有的词原样返回。
 */
const VARIANTS = data as Record<string, string>;

export function canonicalSpelling(token: string): string {
  // 所有格按词干处理：colour's → color's
  const possessive = /^(.+)('s|')$/.exec(token);
  if (possessive) {
    const stem = possessive[1] ?? "";
    return (lookup(stem) ?? stem) + (possessive[2] ?? "");
  }
  return lookup(token) ?? token;
}

function lookup(word: string): string | undefined {
  return Object.hasOwn(VARIANTS, word) ? VARIANTS[word] : undefined;
}

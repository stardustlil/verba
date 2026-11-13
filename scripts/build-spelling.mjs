// 由 VarCon 词表生成英美拼写对照表 src/core/judge/spelling-data.json。
//
// 用法：node scripts/build-spelling.mjs <varcon.txt 的路径>
// 词表来源：https://github.com/en-wl/wordlist （varcon/varcon.txt）
//
// 输出为 { 变体: 规范形式 }，规范形式取美式首选拼写。只收单个单词，
// 不收所有格（'s 结尾的词在运行时按词干处理），不收极少使用的写法。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const input = process.argv[2];
if (!input) {
  console.error("用法：node scripts/build-spelling.mjs <varcon.txt 的路径>");
  process.exit(1);
}

/** 超过这个级别的是罕见词，不收 */
const MAX_LEVEL = 80;
/** 可接受的变体标记：无标记（首选）、v / V（常见变体）、.（同等） */
const ACCEPTED_MARKERS = new Set(["", "v", "V", "."]);

const map = new Map();
let level = 0;

for (const rawLine of readFileSync(input, "utf8").split("\n")) {
  const line = rawLine.trim();
  if (line.startsWith("#")) {
    const match = /\(level (\d+)\)/.exec(line);
    level = match ? Number(match[1]) : 0;
    continue;
  }
  if (line.length === 0 || level > MAX_LEVEL) continue;

  const entries = [];
  for (const part of line.split(" | ")[0].split(" / ")) {
    const colon = part.indexOf(": ");
    if (colon < 0) continue;
    const tags = part.slice(0, colon).trim().split(/\s+/);
    const word = part
      .slice(colon + 2)
      .trim()
      .toLowerCase();
    if (!/^[a-z]+$/.test(word)) continue;
    entries.push({ word, tags });
  }
  if (entries.length < 2) continue;

  const canonical =
    entries.find((e) => e.tags.includes("A")) ??
    entries.find((e) => e.tags.some((t) => t.length === 1));
  if (!canonical) continue;

  for (const entry of entries) {
    if (entry.word === canonical.word) continue;
    const accepted = entry.tags.some((t) => ACCEPTED_MARKERS.has(t.slice(1)));
    if (accepted && !map.has(entry.word)) map.set(entry.word, canonical.word);
  }
}

// 规范形式本身不应再指向别处；消除链式映射
const resolve = (word) => {
  const seen = new Set();
  let current = word;
  while (map.has(current) && !seen.has(current)) {
    seen.add(current);
    current = map.get(current);
  }
  return current;
};
const out = {};
for (const variant of [...map.keys()].sort()) {
  const target = resolve(variant);
  if (target !== variant) out[variant] = target;
}

const outPath = fileURLToPath(new URL("../src/core/judge/spelling-data.json", import.meta.url));
writeFileSync(outPath, JSON.stringify(out) + "\n");
console.log(`已写入 ${Object.keys(out).length} 条到 ${outPath}`);

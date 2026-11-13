/**
 * 内置词书，随应用一起发布，启动时写入数据库（见 repo/books.ts）。
 * 由 scripts/books 生成，数据来源与许可见 SOURCES.md。
 * 改动某本书的内容后，把它的 version 加一，已安装的用户启动时会更新到新版。
 */
import type { BookData } from "../../repo/books";
import prepExpressions from "./prep-expressions.json";
import verbPhrases from "./verb-phrases.json";
import writingCollocations from "./writing-collocations.json";

export const BUILTIN_BOOKS: readonly BookData[] = [
  verbPhrases as BookData,
  prepExpressions as BookData,
  writingCollocations as BookData,
];

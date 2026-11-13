/**
 * 内置词书。内容为本项目原创编写，随应用一起发布，启动时写入数据库（见 repo/books.ts）。
 * 改动某本书的内容后，把它的 version 加一，已安装的用户启动时会补上新条目。
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

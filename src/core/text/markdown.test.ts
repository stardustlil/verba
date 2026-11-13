import { describe, expect, it } from "vitest";
import { cleanText } from "./clean";
import { stripMarkdown } from "./markdown";

describe("stripMarkdown", () => {
  it("去掉标题、强调、链接和行内代码的标记", () => {
    const md = [
      "# The **Big** Title",
      "",
      "This policy has *drawn* [widespread attention](https://example.com) and `code`.",
      "It is a snake_case_name and 2 * 3 * 4.",
    ].join("\n");
    expect(stripMarkdown(md)).toBe(
      [
        "The Big Title",
        "",
        "This policy has drawn widespread attention and code.",
        "It is a snake_case_name and 2 * 3 * 4.",
      ].join("\n"),
    );
  });

  it("丢弃代码块、图片、front matter 和 HTML 标签", () => {
    const md = [
      "---",
      "title: x",
      "---",
      "Before.",
      "",
      "```js",
      "const a = 1;",
      "```",
      "",
      "![alt](a.png) After <b>bold</b>.",
    ].join("\n");
    expect(stripMarkdown(md)).toBe("Before.\n\nAfter bold.");
  });

  it("列表项和引用各自成段", () => {
    const md = ["> A quoted line.", "", "- first item", "- second item", "1. third item"].join(
      "\n",
    );
    expect(cleanText(stripMarkdown(md), "join").text).toBe(
      "A quoted line.\n\nfirst item\n\nsecond item\n\nthird item",
    );
  });

  it("段内换行由 cleanText 合并", () => {
    const md = "## Heading\n\nA line that\ncontinues here.\n\n---\n\nNext.";
    expect(cleanText(stripMarkdown(md), "join").text).toBe(
      "Heading\n\nA line that continues here.\n\nNext.",
    );
  });
});

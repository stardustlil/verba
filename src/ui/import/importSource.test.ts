// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { draftFromFile, draftFromHtml, draftFromPaste } from "./importSource";

const P1 =
  "For decades, ambitious graduates took it for granted that building a career meant moving to a big city. That assumption is starting to fall apart.";
const P2 =
  "Small cities have been quick to take advantage of the shift. Some offer cash incentives to newcomers, while others have poured money into fast internet.";
const P3 =
  "Not everyone is better off, however. Housing prices have soared in the most popular destinations, and longtime residents are struggling to make ends meet.";

describe("draftFromPaste", () => {
  it("清理文本，标题取首行", () => {
    const draft = draftFromPaste(`Remote Work\n\n${P1}`);
    expect(draft).toMatchObject({ title: "Remote Work", sourceType: "paste", sourceRef: null });
    expect(draft.text).toBe(`Remote Work\n\n${P1}`);
  });

  it("首行过长时截断作为标题", () => {
    const draft = draftFromPaste(P1);
    expect(draft.title.length).toBeLessThanOrEqual(61);
    expect(draft.title.endsWith("…")).toBe(true);
    expect(P1.startsWith(draft.title.slice(0, -1))).toBe(true);
  });

  it("带回被合并的断词", () => {
    const raw = [
      "The new policy has drawn wide-",
      "spread attention from experts and has been discussed in every",
      "newspaper across the country for weeks.",
    ].join("\n");
    expect(draftFromPaste(raw).joins.map((j) => j.word)).toEqual(["widespread"]);
  });

  it("没有文字时报错", () => {
    expect(() => draftFromPaste("  \n ")).toThrow("没有可导入的文字");
  });
});

describe("draftFromFile", () => {
  it("txt：标题取文件名", () => {
    const draft = draftFromFile("my article.txt", P1);
    expect(draft).toMatchObject({
      title: "my article",
      sourceType: "file",
      sourceRef: "my article.txt",
    });
    expect(draft.text).toBe(P1);
  });

  it("md：去掉 Markdown 标记", () => {
    const draft = draftFromFile(
      "notes.md",
      `# Title\n\nSome **bold** text\nthat continues.\n\n- item one`,
    );
    expect(draft.text).toBe("Title\n\nSome bold text that continues.\n\nitem one");
  });
});

describe("draftFromHtml", () => {
  const page = `<!doctype html><html><head><title>Remote Work Is Reshaping Small Cities - Example News</title>
    <script>window.evil = true; document.title = "hacked";</script></head>
    <body>
      <nav><a href="/">Home</a> <a href="/world">World</a> <a href="/business">Business</a></nav>
      <article>
        <h1>Remote Work Is Reshaping Small Cities</h1>
        <p>${P1}<sup class="reference"><a href="#cite-1">[1]</a></sup><sup><a href="#cite-2">[2]</a></sup></p>
        <p>${P2} <a href="/more">Read   more
           about it</a>.</p>
        <blockquote><p>${P3}</p></blockquote>
        <ul><li>First point of the list that is long enough to matter here.</li></ul>
        <p>${P1}</p><p>${P2}</p><p>${P3}</p>
      </article>
      <footer>Copyright Example News. All rights reserved.</footer>
    </body></html>`;

  it("提取正文和标题，每个块元素一段", () => {
    const draft = draftFromHtml(page, "https://example.com/a");
    expect(draft.sourceType).toBe("url");
    expect(draft.sourceRef).toBe("https://example.com/a");
    expect(draft.title).toContain("Remote Work Is Reshaping Small Cities");
    const paragraphs = draft.text.split("\n\n");
    expect(paragraphs).toContain(P1);
    expect(paragraphs).toContain(`${P2} Read more about it.`);
    expect(paragraphs).toContain(P3);
    expect(paragraphs).toContain("First point of the list that is long enough to matter here.");
  });

  it("不包含导航、页脚和脚本，也不执行脚本", () => {
    const draft = draftFromHtml(page, "https://example.com/a");
    expect(draft.text).not.toContain("All rights reserved");
    expect(draft.text).not.toContain("[1]");
    expect(draft.text).not.toContain("[2]");
    expect(draft.text).not.toContain("evil");
    expect(draft.text).not.toContain("Business");
    expect((window as unknown as { evil?: boolean }).evil).toBeUndefined();
  });

  it("提取不到正文时提示改用粘贴文本", () => {
    expect(() =>
      draftFromHtml("<html><body><div id='app'></div></body></html>", "https://x.test"),
    ).toThrow("请改用粘贴文本");
  });
});

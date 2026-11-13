/**
 * 把 Markdown 转成纯文本：只去掉标记，保留文字。
 * 标题、列表项各自成段；代码块整体丢弃。结果交给 cleanText(…, "join") 继续处理。
 */
export function stripMarkdown(source: string): string {
  let text = source.replace(/\r\n?/g, "\n");

  // 文件开头的 YAML front matter
  text = text.replace(/^---\n[\s\S]*?\n---\n/, "");
  // 围栏代码块
  text = text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?\n\1[^\n]*$/gm, "");
  // HTML 注释与标签
  text = text.replace(/<!--[\s\S]*?-->/g, "").replace(/<\/?[a-zA-Z][^>\n]*>/g, "");

  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    let line = rawLine;
    // 分隔线、表格分隔行
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line) || /^\s*\|?\s*:?-{3,}[-|:\s]*$/.test(line)) {
      out.push("");
      continue;
    }
    // Setext 标题的下划线
    if (/^\s*(=+|-+)\s*$/.test(line)) {
      out.push("");
      continue;
    }
    line = line.replace(/^\s{0,3}(>\s?)+/, "");

    const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    const listItem = /^\s*(?:[-*+]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
    if (heading) {
      out.push("", inline(heading[1] ?? ""), "");
    } else if (listItem) {
      out.push("", inline(listItem[1] ?? ""));
    } else {
      out.push(inline(line).trim());
    }
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function inline(line: string): string {
  return (
    line
      // 图片整体去掉，链接保留文字
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
      // 脚注引用
      .replace(/\[\^[^\]]+\]/g, "")
      .replace(/`+([^`]*)`+/g, "$1")
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
      .replace(/(?<![\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, "$1")
      .replace(/(?<![\w_])_(?=\S)([^_\n]*?\S)_(?![\w_])/g, "$1")
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
      // 表格的竖线
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .replace(/\s*\|\s*/g, " ")
      .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, "$1")
  );
}

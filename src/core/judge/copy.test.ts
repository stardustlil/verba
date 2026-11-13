import { describe, expect, it } from "vitest";
import { clampCopyInput, copyProgress } from "./copy";

describe("跟写", () => {
  it("逐字母比对，忽略大小写", () => {
    const p = copyProgress("Give up", "giv");
    expect(p).toMatchObject({ matched: 3, wrongAt: null, complete: false });
    expect(p.states.join(",")).toBe("done,done,done,todo,todo,todo,todo");
    expect(copyProgress("Give up", "give UP").complete).toBe(true);
  });

  it("打错的字母标红", () => {
    const p = copyProgress("give up", "gix");
    expect(p.wrongAt).toBe(2);
    expect(p.states.slice(0, 4)).toEqual(["done", "done", "wrong", "todo"]);
  });

  it("直引号与弯引号视为相同", () => {
    expect(copyProgress("make up one's mind", "make up one’s mind").complete).toBe(true);
    expect(copyProgress("one’s", "one's").complete).toBe(true);
  });

  it("打错后必须删掉才能继续；不能超出目标长度；粘贴时同样截断", () => {
    expect(clampCopyInput("give up", "gix")).toBe("gix");
    expect(clampCopyInput("give up", "gixe")).toBe("gix");
    expect(clampCopyInput("give up", "gi")).toBe("gi");
    expect(clampCopyInput("give up", "give upp")).toBe("give up");
    expect(clampCopyInput("give up", "give up")).toBe("give up");
    expect(clampCopyInput("give up", "gave in")).toBe("ga");
  });
});

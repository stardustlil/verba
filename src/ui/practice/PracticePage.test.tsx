// @vitest-environment jsdom
/**
 * 练习页的完整流程：用内存 SQLite 代替 Rust 端，按键盘操作走一遍。
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createArticle } from "../../repo/articles";
import { type Db, newId } from "../../repo/db";
import { createNodeDb } from "../../repo/testing/nodeDb";

const holder: { db: Db | null } = { db: null };

vi.mock("../services", () => ({
  get db() {
    return holder.db;
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const sound = vi.hoisted(() => ({
  playKey: vi.fn(),
  playError: vi.fn(),
  playCorrect: vi.fn(),
  playWrong: vi.fn(),
  setSoundEnabled: vi.fn(),
}));
vi.mock("../sound", () => sound);

const { default: PracticePage } = await import("./PracticePage");

async function seed(db: Db, items: Array<{ lemma: string; surface: string; meaning: string }>) {
  const text = items.map((i) => `They have ${i.surface} for years.`).join(" ");
  const { articleId } = await createArticle(
    db,
    {
      title: "测试文章",
      sourceType: "paste",
      sourceRef: null,
      text,
      selectedParagraphs: new Set(),
    },
    1000,
  );
  const sentences = await db.query<{ id: string; idx: number; text: string }>(
    "SELECT id, idx, text FROM sentences WHERE article_id = ? ORDER BY idx",
    [articleId],
  );
  for (const [i, item] of items.entries()) {
    const sentence = sentences[i]!;
    const id = newId();
    await db.transaction([
      {
        sql: `INSERT INTO chunks (id, lemma, lemma_key, meaning, origin, created_at, sort_time, sort_sentence, sort_offset)
              VALUES (?, ?, ?, ?, 'ai', 1000, 1000, ?, 0)`,
        params: [id, item.lemma, item.lemma.toLowerCase(), item.meaning, sentence.idx],
      },
      {
        sql: `INSERT INTO examples (id, chunk_id, sentence_id, article_id, sentence_text, surface, start_in_sentence, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 1000)`,
        params: [
          newId(),
          id,
          sentence.id,
          articleId,
          sentence.text,
          item.surface,
          sentence.text.indexOf(item.surface),
        ],
      },
    ]);
  }
}

function renderPage(path = "/practice") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PracticePage />
    </MemoryRouter>,
  );
}

const input = () => screen.getByLabelText("你的答案") as HTMLInputElement;

beforeEach(() => {
  holder.db = createNodeDb();
  vi.clearAllMocks();
});
afterEach(cleanup);

const reviews = (db: Db) =>
  db.query<{ mode: string; counted: number; rating: string; viewed_answer: number }>(
    "SELECT mode, counted, rating, viewed_answer FROM reviews ORDER BY answered_at, rowid",
  );

describe("练习流程", () => {
  it("新短语：跟写（错字母被卡住）→ 填空答错照抄 → 重出答对 → 默写看答案 → 重出 → 小结", async () => {
    const db = holder.db!;
    await seed(db, [
      {
        lemma: "draw widespread attention",
        surface: "drawn widespread attention",
        meaning: "引起广泛关注",
      },
    ]);
    const user = userEvent.setup();
    renderPage();

    // 跟写：显示原形和释义，照着打
    await screen.findByText("新短语");
    expect(screen.getByText("引起广泛关注")).toBeTruthy();
    await user.type(input(), "drx");
    expect(input().value).toBe("drx");
    // 错字母没删掉之前，后面的输入不被接受
    await user.type(input(), "a");
    expect(input().value).toBe("drx");
    await user.type(input(), "{Backspace}aw widespread attention");
    expect(await screen.findByText("下一题", { exact: false })).toBeTruthy();
    const [chunk] = await db.query<{ stage: string }>("SELECT stage FROM chunks");
    expect(chunk?.stage).toBe("cloze");
    await user.keyboard(" ");

    // 填空：在例句的空白处直接打字，Tab 提交
    await screen.findByText("提示");
    await user.type(input(), "drawn widesprad attention");
    await user.keyboard("{Tab}");
    expect(await screen.findByText("你写的是")).toBeTruthy();
    expect(screen.getByTitle("应为 widespread")).toBeTruthy();
    // 照着正确答案再打一遍才能继续
    await user.keyboard("{Tab}");
    expect(screen.getByText("你写的是")).toBeTruthy();
    await user.type(input(), "drawn widespread attention");
    await user.keyboard(" ");

    // 本阶段重出：写对的那一刻自动判对，不用按键提交
    await screen.findByText("重出");
    await user.type(input(), "Drawn widespread attention");
    expect(await screen.findByText("下一题", { exact: false })).toBeTruthy();
    await user.keyboard(" ");

    // 默写：只显示中文；没写时按 Tab 看答案，之后要照着打一遍
    await waitFor(() => expect(screen.queryByText("提示")).toBeNull());
    await user.keyboard("{Tab}");
    expect(await screen.findByText("照着打一遍")).toBeTruthy();
    await user.type(input(), "draw widespread attention");
    await user.keyboard(" ");
    await screen.findByText("重出");
    await user.type(input(), "draw widespread attention");
    await user.keyboard(" ");

    expect(await screen.findByText("本轮完成")).toBeTruthy();
    expect(screen.getByText("0%")).toBeTruthy();
    expect(await reviews(db)).toEqual([
      { mode: "cloze", counted: 1, rating: "again", viewed_answer: 0 },
      { mode: "cloze", counted: 0, rating: "good", viewed_answer: 0 },
      { mode: "recall", counted: 0, rating: "again", viewed_answer: 1 },
      { mode: "recall", counted: 0, rating: "good", viewed_answer: 0 },
    ]);
    const [time] = await db.query<{ study_ms: number }>("SELECT study_ms FROM days");
    expect(time?.study_ms).toBeGreaterThan(0);
  });

  it("复习中的纯中文默写：我写的也对存为备选答案", async () => {
    const db = holder.db!;
    await seed(db, [{ lemma: "draw attention", surface: "drawn attention", meaning: "引起注意" }]);
    await db.transaction([{ sql: "UPDATE chunks SET stage = 'recall', due = 0", params: [] }]);
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("引起注意");
    await user.type(input(), "attract attention");
    await user.keyboard("{Tab}");
    await screen.findByText("你写的是");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(await screen.findByText("已改判为正确")).toBeTruthy();
    await user.keyboard(" ");
    expect(await screen.findByText("本轮完成")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();

    const alts = await db.query<{ text: string }>("SELECT text FROM alt_answers");
    expect(alts).toEqual([{ text: "attract attention" }]);
  });

  it("删除后进入下一题，撤销后回来；修改释义；Esc 结束本轮", async () => {
    const db = holder.db!;
    await seed(db, [
      { lemma: "heavy rain", surface: "heavy rain", meaning: "大雨" },
      { lemma: "make a decision", surface: "make a decision", meaning: "做决定" },
    ]);
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("大雨");
    await user.keyboard("{Control>}d{/Control}");
    expect(await screen.findByText("做决定")).toBeTruthy();
    expect(await db.query("SELECT * FROM ignored_lemmas")).toHaveLength(1);

    await user.keyboard("{Control>}z{/Control}");
    expect(await screen.findByText("大雨")).toBeTruthy();
    expect(await db.query("SELECT * FROM ignored_lemmas")).toHaveLength(0);

    await user.keyboard("{Control>}e{/Control}");
    const field = screen.getByLabelText("中文释义") as HTMLInputElement;
    await user.clear(field);
    await user.type(field, "倾盆大雨");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("倾盆大雨")).toBeTruthy();
    const [row] = await db.query<{ meaning: string }>(
      "SELECT meaning FROM chunks WHERE lemma = 'heavy rain'",
    );
    expect(row?.meaning).toBe("倾盆大雨");

    await user.keyboard("{Escape}");
    expect(await screen.findByText("回首页")).toBeTruthy();
  });

  it("到了小结之后，切走再切回窗口不会继续累计学习时长", async () => {
    const db = holder.db!;
    await seed(db, [{ lemma: "heavy rain", surface: "heavy rain", meaning: "大雨" }]);
    const user = userEvent.setup();
    const view = renderPage();
    await screen.findByText("大雨");
    await user.keyboard("{Escape}");
    await screen.findByText("回首页");
    const studyMs = async () =>
      (await db.query<{ ms: number }>("SELECT COALESCE(SUM(study_ms), 0) AS ms FROM days"))[0]!.ms;
    const atSummary = await studyMs();

    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    // 在小结页停了十分钟才离开
    const later = performance.now() + 10 * 60 * 1000;
    const clock = vi.spyOn(performance, "now").mockReturnValue(later);
    view.unmount();
    clock.mockRestore();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await studyMs()).toBe(atSummary);
  });

  it("标记熟练：跳过这个短语，撤销后回来", async () => {
    const db = holder.db!;
    await seed(db, [
      { lemma: "heavy rain", surface: "heavy rain", meaning: "大雨" },
      { lemma: "make a decision", surface: "make a decision", meaning: "做决定" },
    ]);
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("大雨");
    await user.keyboard("{Control>}k{/Control}");
    expect(await screen.findByText("做决定")).toBeTruthy();
    const [row] = await db.query<{ stage: string }>(
      "SELECT stage FROM chunks WHERE lemma = 'heavy rain'",
    );
    expect(row?.stage).toBe("recall");

    await user.keyboard("{Control>}z{/Control}");
    expect(await screen.findByText("大雨")).toBeTruthy();
    const [back] = await db.query<{ stage: string }>(
      "SELECT stage FROM chunks WHERE lemma = 'heavy rain'",
    );
    expect(back?.stage).toBe("new");

    // 顶栏按钮
    await user.click(screen.getByLabelText("标记熟练"));
    expect(await screen.findByText("做决定")).toBeTruthy();
  });

  it("额外练习：只出新短语，不出到期复习，学过的不占每日额度", async () => {
    const db = holder.db!;
    await seed(db, [
      { lemma: "heavy rain", surface: "heavy rain", meaning: "大雨" },
      { lemma: "make a decision", surface: "make a decision", meaning: "做决定" },
    ]);
    // 第一个是到期复习
    await db.transaction([
      { sql: "UPDATE chunks SET stage = 'recall', due = 0 WHERE lemma = 'heavy rain'", params: [] },
    ]);
    const user = userEvent.setup();
    renderPage("/practice?extra=1");

    await screen.findByText("新短语");
    expect(screen.getByText("额外练习")).toBeTruthy();
    expect(screen.getByText("做决定")).toBeTruthy();
    await user.type(input(), "make a decision");
    await screen.findByText("下一题", { exact: false });
    const [row] = await db.query<{ introduced_extra: number }>(
      "SELECT introduced_extra FROM chunks WHERE lemma = 'make a decision'",
    );
    expect(row?.introduced_extra).toBe(1);
    const [quota] = await db.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM chunks WHERE introduced_extra = 0 AND introduced_day IS NOT NULL",
    );
    expect(quota?.n).toBe(0);
    expect(screen.queryByText("大雨")).toBeNull();
  });
});

describe("打字音效", () => {
  it("按键、打错字母、跟写完成、答对答错各有音效", async () => {
    const db = holder.db!;
    await seed(db, [{ lemma: "heavy rain", surface: "heavy rain", meaning: "大雨" }]);
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("新短语");
    expect(sound.setSoundEnabled).toHaveBeenLastCalledWith(true);
    await user.type(input(), "he");
    expect(sound.playKey).toHaveBeenCalledTimes(2);
    await user.type(input(), "x");
    expect(sound.playError).toHaveBeenCalledTimes(1);
    await user.type(input(), "{Backspace}avy rain");
    await screen.findByText("下一题", { exact: false });
    expect(sound.playCorrect).toHaveBeenCalledTimes(1);
    await user.keyboard(" ");

    // 填空答错
    await screen.findByText("提示");
    await user.type(input(), "heavy snow");
    await user.keyboard("{Tab}");
    await screen.findByText("你写的是");
    expect(sound.playWrong).toHaveBeenCalledTimes(1);
  });

  it("底栏开关：关闭后写回设置，下次进来保持关闭", async () => {
    const db = holder.db!;
    await seed(db, [{ lemma: "heavy rain", surface: "heavy rain", meaning: "大雨" }]);
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("新短语");
    await user.click(screen.getByLabelText("打字音效"));
    expect(sound.setSoundEnabled).toHaveBeenLastCalledWith(false);
    await waitFor(async () => {
      const [row] = await db.query<{ value: string }>(
        "SELECT value FROM meta WHERE key = 'typing_sound'",
      );
      expect(row?.value).toBe("false");
    });

    cleanup();
    vi.clearAllMocks();
    renderPage();
    await screen.findByText("新短语");
    expect(sound.setSoundEnabled).toHaveBeenLastCalledWith(false);
  });
});

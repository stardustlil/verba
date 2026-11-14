// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../repo/db";
import { getSettings } from "../../repo/settings";
import { createNodeDb } from "../../repo/testing/nodeDb";

const holder: { db: Db | null } = { db: null };

vi.mock("../services", () => ({
  get db() {
    return holder.db;
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  getApiKeyMasked: async () => null,
  setApiKey: vi.fn(),
  openDataDir: vi.fn(),
}));
// theme.ts 在加载时就要用 matchMedia，jsdom 里没有
vi.mock("../theme", () => ({ applyTheme: vi.fn(), onThemeChange: () => () => undefined }));

const { default: SettingsPage } = await import("./SettingsPage");

beforeEach(() => {
  holder.db = createNodeDb();
});
afterEach(cleanup);

describe("设置", () => {
  it("数字填得不对：提示错误，输入框恢复原值；填对了才保存", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    const field = (await screen.findByLabelText("每日新短语数")) as HTMLInputElement;
    expect(field.value).toBe("20");

    await user.clear(field);
    await user.type(field, "0");
    await user.tab();
    expect(screen.getByRole("alert").textContent).toContain("1 到 500");
    expect(field.value).toBe("20");
    expect((await getSettings(holder.db!)).dailyNew).toBe(20);

    await user.clear(field);
    await user.type(field, "35");
    await user.tab();
    await waitFor(async () => expect((await getSettings(holder.db!)).dailyNew).toBe(35));
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByLabelText("每日新短语数") as HTMLInputElement).value).toBe("35");
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import GuidePage from "./GuidePage";

afterEach(cleanup);

const section = (title: string) =>
  screen.getByRole("heading", { level: 2, name: title, hidden: true }).closest("section")!;

describe("使用说明", () => {
  it("搜索只留下包含关键词的章节；清空后全部恢复", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GuidePage />
      </MemoryRouter>,
    );
    expect(section("快速上手").hidden).toBe(false);

    await user.type(screen.getByLabelText("搜索说明"), "凌晨 4 点");
    expect(section("打卡与记录").hidden).toBe(false);
    expect(section("常见问题").hidden).toBe(false);
    expect(section("快捷键").hidden).toBe(true);

    await user.type(screen.getByLabelText("搜索说明"), "找不到的内容");
    expect(screen.getByText(/没有找到/)).toBeTruthy();

    await user.clear(screen.getByLabelText("搜索说明"));
    expect(section("快捷键").hidden).toBe(false);
  });
});

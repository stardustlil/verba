import { describe, expect, it } from "vitest";
import { Stopwatch } from "./stopwatch";

describe("答题计时", () => {
  it("从第一次按键开始，失焦时暂停，回来后继续", () => {
    let now = 0;
    const watch = new Stopwatch(() => now);
    now = 5000; // 读题时间不计
    expect(watch.elapsed()).toBe(0);
    watch.start();
    now = 7000;
    watch.pause();
    now = 60_000; // 窗口失焦期间不计
    watch.resume();
    now = 61_000;
    expect(watch.elapsed()).toBe(3000);
    watch.start(); // 已开始时忽略
    expect(watch.elapsed()).toBe(3000);
  });

  it("还没开始时失焦再回来，不会开始计时", () => {
    let now = 0;
    const watch = new Stopwatch(() => now);
    watch.pause();
    watch.resume();
    now = 10_000;
    expect(watch.started).toBe(false);
    expect(watch.elapsed()).toBe(0);
  });

  it("重置", () => {
    let now = 0;
    const watch = new Stopwatch(() => now);
    watch.start();
    now = 1000;
    watch.reset();
    expect(watch.elapsed()).toBe(0);
    expect(watch.started).toBe(false);
  });
});

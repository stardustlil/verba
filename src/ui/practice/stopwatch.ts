/**
 * 答题计时（需求 5.5）：从在输入框中按下第一个键开始，窗口失去焦点时暂停。
 */
export class Stopwatch {
  private state: "idle" | "running" | "paused" = "idle";
  private since = 0;
  private accumulated = 0;

  constructor(private readonly clock: () => number = () => performance.now()) {}

  get started(): boolean {
    return this.state !== "idle";
  }

  /** 第一次按键时调用；已开始则忽略 */
  start(): void {
    if (this.state !== "idle") return;
    this.state = "running";
    this.since = this.clock();
  }

  pause(): void {
    if (this.state !== "running") return;
    this.accumulated += this.clock() - this.since;
    this.state = "paused";
  }

  /** 窗口重新获得焦点时调用；还没开始计时的不会因此开始 */
  resume(): void {
    if (this.state !== "paused") return;
    this.state = "running";
    this.since = this.clock();
  }

  elapsed(): number {
    return this.accumulated + (this.state === "running" ? this.clock() - this.since : 0);
  }

  reset(): void {
    this.state = "idle";
    this.accumulated = 0;
  }
}

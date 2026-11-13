/** 动画用的小工具 */
import { useEffect, useRef, useState } from "react";

/** 用户在系统里选择了“减少动态效果”，或运行环境不支持动画（如测试） */
export function reducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  if (typeof window.requestAnimationFrame !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 快起慢收 */
export function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

/** 数字从上一次的值滚动到新值 */
export function useCountUp(value: number, duration = 700): number {
  const [shown, setShown] = useState(() => (reducedMotion() ? value : 0));
  const from = useRef(shown);
  useEffect(() => {
    if (reducedMotion()) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const begin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const current = begin + (value - begin) * easeOutExpo(t);
      from.current = current;
      setShown(current);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return Math.round(shown);
}

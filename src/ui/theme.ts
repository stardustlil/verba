import type { Theme } from "../repo/settings";

const media = window.matchMedia("(prefers-color-scheme: dark)");
let current: Theme = "system";
const listeners = new Set<(theme: Theme) => void>();

function apply() {
  const dark = current === "dark" || (current === "system" && media.matches);
  document.documentElement.classList.toggle("dark", dark);
}

media.addEventListener("change", apply);

/** 主题：跟随系统，或固定为亮 / 暗（需求第 9 节） */
export function applyTheme(theme: Theme) {
  current = theme;
  apply();
  for (const listener of listeners) listener(theme);
}

export function currentTheme(): Theme {
  return current;
}

/** 主题改变时通知（侧栏和设置页都能切换主题，彼此要同步） */
export function onThemeChange(listener: (theme: Theme) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

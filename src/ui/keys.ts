/** 键盘相关的小工具（需求 5.8） */

export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Mac 用 Cmd，Windows / Linux 用 Ctrl */
export function hasMod(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

/** 快捷键的显示文字，如 ⌘E / Ctrl+E */
export function modLabel(key: string): string {
  return IS_MAC ? `⌘${key}` : `Ctrl+${key}`;
}

let composing = false;
let composedAt = -Infinity;
document.addEventListener("compositionstart", () => (composing = true), true);
document.addEventListener(
  "compositionend",
  () => {
    composing = false;
    composedAt = performance.now();
  },
  true,
);

/**
 * 这个按键是否属于输入法选词过程。
 * WebKit 里确认候选词的 Enter 会在 compositionend 之后才到达，
 * isComposing 已是 false，但 keyCode 仍为 229；再加一个时间窗兜底。
 */
export function isImeKey(e: KeyboardEvent | React.KeyboardEvent): boolean {
  const native = "nativeEvent" in e ? e.nativeEvent : e;
  return (
    native.isComposing || native.keyCode === 229 || composing || performance.now() - composedAt < 50
  );
}

/** 当前焦点是否在可输入文字的元素上 */
export function focusedTextField(): HTMLInputElement | HTMLTextAreaElement | null {
  const el = document.activeElement;
  if (el instanceof HTMLTextAreaElement) return el;
  if (el instanceof HTMLInputElement && !["checkbox", "radio", "button"].includes(el.type))
    return el;
  return null;
}

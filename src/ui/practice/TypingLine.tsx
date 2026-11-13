/**
 * 原位打字：没有输入框，字母直接打在题目所在的位置。
 * 一个透明的 <input> 负责接收按键（兼顾输入法、粘贴、系统的撤销），字母由这里渲染。
 *
 * - copy：照着 target 逐字母输入，输对的变深色、输错的标红，错字母之后的输入一律不接受
 * - free：自由输入，按 Enter 后由练习页判对错
 */
import { type RefObject, useState } from "react";
import { clampCopyInput, copyProgress } from "../../core/judge/copy";
import { cx } from "../components";
import { playError, playKey } from "../sound";

export interface TypingLineProps {
  mode: "copy" | "free";
  /** copy：要照着输入的文字；free：只用来估计下划线的最小宽度 */
  target: string;
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  /** 判对后整行变绿 */
  tone?: "neutral" | "good";
  readOnly?: boolean;
  /** 尺寸：hero 用于单独一行的大字，inline 用于嵌在例句里 */
  size?: "hero" | "inline";
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** 输入法开始 / 结束组字 */
  onComposingChange?: (composing: boolean) => void;
  ariaLabel: string;
}

function Caret() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-[12%] bottom-[12%] -ml-px w-[2px] animate-blink rounded bg-accent"
    />
  );
}

export function TypingLine({
  mode,
  target,
  value,
  onChange,
  inputRef,
  tone = "neutral",
  readOnly,
  size = "hero",
  onKeyDown,
  onComposingChange,
  ariaLabel,
}: TypingLineProps) {
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  const handleChange = (raw: string) => {
    const next = raw.replace(/[\r\n]/g, "");
    if (composing) {
      onChange(next);
      return;
    }
    if (mode === "copy") {
      const clamped = clampCopyInput(target, next);
      const before = copyProgress(target, value);
      const after = copyProgress(target, clamped);
      // 新打出一个错字母，或在错字母后继续打：抖一下提示
      if (
        (after.wrongAt !== null && before.wrongAt === null) ||
        (clamped.length < next.length && next.length > value.length)
      ) {
        setShakeKey((k) => k + 1);
        playError();
      } else if (clamped.length > value.length) {
        playKey();
      }
      onChange(clamped);
      return;
    }
    if (next.length > value.length) playKey();
    onChange(next);
  };

  const showCaret = focused && !readOnly && !composing;
  const text =
    size === "hero"
      ? "font-display text-[2.6rem] leading-tight tracking-[0.01em]"
      : "font-display text-[1.45rem] leading-snug";

  let body: React.ReactNode;
  if (mode === "copy") {
    const progress = copyProgress(target, value);
    const caretAt = progress.wrongAt !== null ? progress.wrongAt + 1 : progress.matched;
    const typed = [...value];
    body = [...target].map((ch, i) => {
      const state = progress.states[i];
      const shown = state === "wrong" ? (typed[i] ?? ch) : ch;
      return (
        <span key={i} className="relative">
          {showCaret && i === caretAt && <Caret />}
          <span
            className={cx(
              "whitespace-pre transition-colors duration-150",
              state === "done" && (tone === "good" ? "text-good" : "text-ink"),
              state === "wrong" && "text-bad underline decoration-bad decoration-2",
              state === "todo" && "text-ink-faint/70",
            )}
          >
            {shown === " " && state === "wrong" ? "·" : shown}
          </span>
          {showCaret && i === target.length - 1 && caretAt === target.length && (
            <span className="relative">
              <Caret />
            </span>
          )}
        </span>
      );
    });
  } else {
    const minCh = size === "hero" ? 12 : Math.max(6, Math.min(16, target.length));
    body = (
      <span
        className={cx(
          "relative inline-block border-b-2 px-1 pb-0.5 text-center",
          tone === "good" ? "border-good text-good" : "border-line-strong text-ink",
          focused && tone !== "good" && "border-accent",
        )}
        style={{ minWidth: `${minCh}ch` }}
      >
        <span className="whitespace-pre">{value}</span>
        {showCaret && (
          <span className="relative">
            <Caret />
          </span>
        )}
        {value === "" && <span className="whitespace-pre"> </span>}
      </span>
    );
  }

  return (
    <span
      className={cx("relative inline-block cursor-text align-baseline", text)}
      onMouseDown={(e) => {
        e.preventDefault();
        inputRef.current?.focus();
      }}
    >
      <span
        key={`${shakeKey}:${tone}`}
        className={cx(
          "inline-block",
          shakeKey > 0 && tone !== "good" && "animate-shake",
          tone === "good" && "animate-bounce-in",
        )}
      >
        {body}
      </span>
      <input
        ref={inputRef}
        aria-label={ariaLabel}
        value={value}
        readOnly={readOnly}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onCompositionStart={() => {
          setComposing(true);
          onComposingChange?.(true);
        }}
        onCompositionEnd={(e) => {
          setComposing(false);
          onComposingChange?.(false);
          handleChange(e.currentTarget.value);
        }}
      />
    </span>
  );
}

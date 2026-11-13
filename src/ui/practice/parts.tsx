/** 练习页、句块详情等处共用的展示组件 */
import type { ReactNode } from "react";
import type { WordMark } from "../../core/judge/diff";
import { cx } from "../components";

/** 原句：句块位置高亮，或换成别的内容（如原位打字行） */
export function Sentence({
  text,
  start,
  length,
  slot,
  tone = "mark",
  className,
}: {
  text: string;
  start: number;
  length: number;
  /** 放在句块位置上的内容；不传则高亮原文 */
  slot?: ReactNode;
  tone?: "mark" | "good";
  className?: string;
}) {
  const before = text.slice(0, start);
  const target = text.slice(start, start + length);
  const after = text.slice(start + length);
  return (
    <p className={cx("font-display leading-relaxed", className)}>
      {before}
      {slot ?? (
        <mark
          className={cx(
            "rounded px-0.5 text-inherit",
            tone === "good" ? "bg-good-soft text-good" : "bg-mark",
          )}
        >
          {target}
        </mark>
      )}
      {after}
    </p>
  );
}

/** 逐词标出对错，错词内标出具体错在哪个字母（需求 5.4） */
export function AnswerDiff({ marks, className }: { marks: WordMark[]; className?: string }) {
  return (
    <span className={cx("font-display", className)}>
      {marks.map((mark, i) => {
        const space = i > 0 ? " " : "";
        switch (mark.kind) {
          case "ok":
            return (
              <span key={i} className="text-good">
                {space}
                {mark.text}
              </span>
            );
          case "extra":
            return (
              <span key={i}>
                {space}
                <span className="text-bad line-through decoration-2" title="多写的词">
                  {mark.text}
                </span>
              </span>
            );
          case "missing":
            return (
              <span key={i}>
                {space}
                <span
                  title="漏写的词"
                  className="rounded border border-dashed border-bad/60 px-1 text-bad/80"
                >
                  {mark.expected}
                </span>
              </span>
            );
          case "wrong":
            return (
              <span key={i}>
                {space}
                <span className="text-bad" title={`应为 ${mark.expected}`}>
                  {mark.chars.map((c, j) =>
                    c.kind === "ok" ? (
                      <span key={j}>{c.ch}</span>
                    ) : c.kind === "wrong" ? (
                      <span key={j} className="rounded-sm bg-bad px-px text-white">
                        {c.ch}
                      </span>
                    ) : (
                      <span
                        key={j}
                        title="漏写的字母"
                        className="text-bad/60 underline decoration-2 underline-offset-4"
                      >
                        {c.ch}
                      </span>
                    ),
                  )}
                </span>
              </span>
            );
          default:
            return null;
        }
      })}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-5 items-center justify-center rounded-md border border-line-strong border-b-2 bg-panel px-1.5 py-px font-sans text-[11px] font-medium text-ink-soft">
      {children}
    </kbd>
  );
}

/** 题目下方的小提示条，如“输入完成后按 Enter 继续” */
export function HintPill({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-panel-muted px-3.5 py-1.5 text-xs text-ink-soft ring-1 ring-line">
      {children}
    </div>
  );
}

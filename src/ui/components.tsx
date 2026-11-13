/** 基础组件。颜色、字体等设计令牌定义在 styles.css 中。 */
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "soft";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-white shadow-sm shadow-accent/30 hover:bg-accent-strong disabled:bg-line-strong disabled:text-ink-faint disabled:shadow-none dark:text-[#16121f]",
  secondary:
    "bg-panel text-ink ring-1 ring-line-strong hover:bg-panel-muted disabled:text-ink-faint",
  ghost: "text-ink-soft hover:bg-ink/5 hover:text-ink disabled:text-ink-faint",
  danger: "bg-bad text-white hover:opacity-90 disabled:opacity-50",
  soft: "bg-accent-soft text-accent-ink hover:bg-accent/20 disabled:opacity-50",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-2.5 text-xs",
  md: "h-9 gap-2 rounded-xl px-3.5 text-sm",
  lg: "h-11 gap-2 rounded-xl px-5 text-[15px]",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-all",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100",
        BUTTON_SIZES[size],
        BUTTON_STYLES[variant],
        className,
      )}
    />
  );
}

const INPUT_STYLE =
  "w-full rounded-xl border border-line-strong bg-panel px-3 text-sm text-ink placeholder:text-ink-faint " +
  "transition-colors focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15";

export function TextInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      {...props}
      className={cx(INPUT_STYLE, "h-10", className)}
    />
  );
}

export const textAreaStyle = cx(INPUT_STYLE, "py-2.5 leading-relaxed");

export const selectStyle =
  "h-10 cursor-pointer rounded-xl border border-line-strong bg-panel px-3 pr-8 text-sm text-ink " +
  "transition-colors focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15";

export function Page({
  title,
  description,
  actions,
  children,
  width = "default",
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  width?: "default" | "narrow";
}) {
  return (
    <div
      className={cx(
        "mx-auto flex h-full w-full flex-col px-10 pt-9 pb-6",
        width === "narrow" ? "max-w-3xl" : "max-w-5xl",
      )}
    >
      <header className="mb-7 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold tracking-tight text-ink">{title}</h1>
          {description && <div className="mt-1 text-sm text-ink-soft">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function Card({
  className,
  children,
  ...props
}: ComponentProps<"div"> & { children: ReactNode }) {
  return (
    <div {...props} className={cx("rounded-2xl bg-panel shadow-card ring-1 ring-line", className)}>
      {children}
    </div>
  );
}

export function ProgressBar({
  value,
  max,
  className,
  tone = "accent",
}: {
  value: number;
  max: number;
  className?: string;
  tone?: "accent" | "good";
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={cx("h-1.5 overflow-hidden rounded-full bg-ink/8", className)}>
      <div
        className={cx(
          "h-full rounded-full transition-[width] duration-300",
          tone === "good" ? "bg-good" : "bg-accent",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "success" | "warning";
  children: ReactNode;
}) {
  const tones = {
    info: "bg-panel-muted text-ink-soft ring-line",
    error: "bg-bad-soft text-bad ring-bad/20",
    success: "bg-good-soft text-good ring-good/20",
    warning: "bg-warn-soft text-warn ring-warn/25",
  };
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx("rounded-xl px-4 py-3 text-sm ring-1", tones[tone])}
    >
      {children}
    </div>
  );
}

function Overlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6 backdrop-blur-[2px]"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.nativeEvent.isComposing) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
}

/** 需要用户确认的提示框。Esc 或点“取消”关闭。 */
export function Dialog({
  title,
  children,
  confirmLabel,
  cancelLabel = "取消",
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Overlay onClose={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md animate-rise rounded-2xl bg-panel p-6 shadow-float ring-1 ring-line"
      >
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <div className="mt-2 text-sm leading-relaxed text-ink-soft">{children}</div>
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Overlay>
  );
}

/** 表单类的弹窗。Esc 关闭。 */
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <Overlay onClose={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-full w-full max-w-lg animate-rise overflow-y-auto rounded-2xl bg-panel p-6 shadow-float ring-1 ring-line"
      >
        <h2 className="mb-4 text-base font-semibold text-ink">{title}</h2>
        {children}
      </div>
    </Overlay>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

export { cx };

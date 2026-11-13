/** 展示用的格式化与小组件 */
import { studyDay } from "../core/srs/day";
import type { ChunkStatus } from "../core/srs/stage";
import { cx } from "./components";

export function formatDate(at: number): string {
  return new Date(at).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

export function formatDateTime(at: number): string {
  return new Date(at).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 下次复习：按学习日显示，到期的显示“今天” */
export function formatDue(due: number | null, status: ChunkStatus, now = Date.now()): string {
  if (status === "new") return "—";
  if (due === null) return "今天";
  const day = studyDay(due);
  const today = studyDay(now);
  if (day <= today) return "今天";
  const [y, m, d] = day.split("-").map(Number);
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return sameYear ? `${m}月${d}日` : `${y}年${m}月${d}日`;
}

const STATUS_LABEL: Record<ChunkStatus, string> = {
  new: "新",
  learning: "学习中",
  mastered: "已掌握",
};

const STATUS_STYLE: Record<ChunkStatus, string> = {
  new: "bg-ink/5 text-ink-soft",
  learning: "bg-mark text-warn",
  mastered: "bg-good-soft text-good",
};

export function statusLabel(status: ChunkStatus): string {
  return STATUS_LABEL[status];
}

export function StatusBadge({ status }: { status: ChunkStatus }) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-medium",
        STATUS_STYLE[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** 练习记录热图：一格一天，一列一周（周一在上），颜色越深练得越多 */
import { useLayoutEffect, useRef, useState } from "react";
import { dayStart } from "../core/srs/day";
import type { DayRecord } from "../repo/stats";
import { cx } from "./components";

const CELL = 13;
const GAP = 3;
const WEEKDAY_LABELS = ["一", "", "三", "", "五", "", ""];

/** 当天练习量的深浅等级 0–4 */
export function heatLevel(answered: number): number {
  if (answered <= 0) return 0;
  if (answered < 10) return 1;
  if (answered < 25) return 2;
  if (answered < 50) return 3;
  return 4;
}

const LEVEL_STYLE = ["bg-ink/[0.06]", "bg-accent/25", "bg-accent/50", "bg-accent/75", "bg-accent"];

/** 星期一为 0 */
function weekdayIndex(day: string): number {
  return (new Date(dayStart(day)).getDay() + 6) % 7;
}

/** 热图要显示的天数：从 weeks 周前那周的周一到今天 */
export function heatmapSpan(today: string, weeks: number): number {
  return (weeks - 1) * 7 + weekdayIndex(today) + 1;
}

function label(d: DayRecord): string {
  const date = new Date(dayStart(d.day));
  const head = date.toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  if (d.answered === 0 && d.studyMs === 0) return `${head} · 没有练习`;
  const minutes = Math.max(1, Math.round(d.studyMs / 60000));
  return `${head} · 练习 ${d.answered} 个短语 · ${minutes} 分钟${d.completed ? " · 已打卡" : ""}`;
}

export function Heatmap({ days }: { days: DayRecord[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(53);
  const [hover, setHover] = useState<DayRecord | null>(null);

  // 窗口窄时只显示放得下的最近几周
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setFit(Math.max(8, Math.floor((el.clientWidth + GAP) / (CELL + GAP))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (days.length === 0) return null;
  const first = days[0]!.day;
  const lead = weekdayIndex(first);
  const cells: Array<DayRecord | null> = [...Array<null>(lead).fill(null), ...days];
  const weeks: Array<Array<DayRecord | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const shown = weeks.slice(-fit);
  const today = days.at(-1)!.day;

  // 月份标签：每月第一次出现的那一列
  const months: Array<{ col: number; text: string }> = [];
  shown.forEach((week, col) => {
    const firstDay = week.find((d) => d !== null);
    if (!firstDay) return;
    const date = new Date(dayStart(firstDay.day));
    const prev = col > 0 ? shown[col - 1]!.find((d) => d !== null) : null;
    const prevMonth = prev ? new Date(dayStart(prev.day)).getMonth() : -1;
    if (date.getMonth() !== prevMonth) months.push({ col, text: `${date.getMonth() + 1}月` });
  });

  return (
    <div className="flex gap-2">
      <div
        className="grid shrink-0 pt-5 text-[10px] leading-none text-ink-faint"
        style={{ gridTemplateRows: `repeat(7, ${CELL}px)`, rowGap: GAP }}
      >
        {WEEKDAY_LABELS.map((w, i) => (
          <span key={i} className="flex items-center">
            {w}
          </span>
        ))}
      </div>
      <div ref={box} className="min-w-0 flex-1">
        <div className="relative h-5 text-[10px] text-ink-faint">
          {months.map((m, i) =>
            // 太挤时跳过紧挨着的标签
            i > 0 && m.col - months[i - 1]!.col < 3 ? null : (
              <span key={m.col} className="absolute top-0" style={{ left: m.col * (CELL + GAP) }}>
                {m.text}
              </span>
            ),
          )}
        </div>
        <div className="flex" style={{ gap: GAP }} onMouseLeave={() => setHover(null)}>
          {shown.map((week, col) => (
            <div key={col} className="flex flex-col" style={{ gap: GAP }}>
              {Array.from({ length: 7 }, (_, row) => {
                const d = week[row] ?? null;
                if (!d) return <span key={row} style={{ width: CELL, height: CELL }} />;
                return (
                  <span
                    key={row}
                    role="img"
                    aria-label={label(d)}
                    title={label(d)}
                    onMouseEnter={() => setHover(d)}
                    className={cx(
                      "animate-cell rounded-[3px] transition-transform duration-300 ease-spring hover:scale-[1.35]",
                      LEVEL_STYLE[heatLevel(d.answered)],
                      d.day === today && "ring-2 ring-accent/60 ring-offset-1 ring-offset-panel",
                    )}
                    style={{
                      width: CELL,
                      height: CELL,
                      animationDelay: `${Math.min(col * 12 + row * 6, 700)}ms`,
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between gap-4 text-[11px] text-ink-soft">
          <span className="min-h-4 truncate">{hover ? label(hover) : ""}</span>
          <span className="flex shrink-0 items-center gap-1 text-ink-faint">
            少
            {LEVEL_STYLE.map((s, i) => (
              <span key={i} className={cx("size-[11px] rounded-[3px]", s)} />
            ))}
            多
          </span>
        </div>
      </div>
    </div>
  );
}

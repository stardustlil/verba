import { CalendarCheck, CheckCircle2, Clock, Flame, Play, Plus, Trophy } from "lucide-react";
import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { dayStart } from "../../core/srs/day";
import { currentBookId, listBooks } from "../../repo/books";
import { getSettings } from "../../repo/settings";
import { homeStats, recentDays } from "../../repo/stats";
import { EXTRA_COUNT } from "../../repo/study";
import { BookCover } from "../bookCover";
import { Button, Card, Notice, ProgressBar, cx } from "../components";
import { useAsync } from "../hooks";
import { db } from "../services";

async function load() {
  const now = Date.now();
  const settings = await getSettings(db);
  const bookId = await currentBookId(db);
  const [stats, books, week] = await Promise.all([
    homeStats(db, settings.dailyNew, now, bookId),
    listBooks(db),
    recentDays(db, now, 7),
  ]);
  return {
    stats,
    book: books.find((b) => b.id === bookId) ?? null,
    week,
    dailyNew: settings.dailyNew,
  };
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function minutes(ms: number): string {
  if (ms <= 0) return "0";
  return String(Math.max(1, Math.round(ms / 60000)));
}

/** 今日任务的环形进度 */
function Ring({ pct }: { pct: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-[88px] shrink-0">
      <svg viewBox="0 0 80 80" className="size-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="7" className="stroke-ink/8" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          opacity={pct > 0 ? 1 : 0}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className={cx(
            "transition-[stroke-dashoffset] duration-500",
            pct >= 1 ? "stroke-good" : "stroke-accent",
          )}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {pct >= 1 ? (
          <CheckCircle2 size={26} className="text-good" />
        ) : (
          <span className="text-lg font-semibold tabular-nums">{Math.round(pct * 100)}%</span>
        )}
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  unit,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string | undefined;
  unit?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
        {icon}
      </span>
      <span className="flex-1 text-sm text-ink-soft">{label}</span>
      <span className="text-lg font-semibold tabular-nums">
        {value ?? "–"}
        {unit && value !== undefined && (
          <span className="ml-1 text-xs font-normal text-ink-soft">{unit}</span>
        )}
      </span>
    </div>
  );
}

/** 首页（需求第 6 节） */
export default function HomePage() {
  const data = useAsync(load, []);
  const navigate = useNavigate();
  const s = data.data?.stats;
  const book = data.data?.book;
  const week = data.data?.week ?? [];
  const today = week.at(-1);
  const canStart = s !== undefined && s.dueToday + s.newToday > 0;
  const extraCount = book ? Math.min(EXTRA_COUNT, book.fresh) : 0;
  const remaining = s ? s.dueToday + s.newToday : 0;
  // 今日任务完成度：今天已练的 / (已练 + 还剩)；没有任务时算完成
  const progress = !s
    ? 0
    : s.doneToday + remaining > 0
      ? Math.min(1, s.doneToday / (s.doneToday + remaining))
      : 1;

  // 首页按 Enter 直接开始学习
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "BUTTON", "A", "SELECT"].includes(target.tagName)) return;
      if (canStart) {
        e.preventDefault();
        navigate("/practice");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canStart, navigate]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-10 pt-9 pb-8">
        <header className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight">今天</h1>
            <p className="mt-1 text-sm text-ink-soft">
              {new Date().toLocaleDateString("zh-CN", {
                month: "long",
                day: "numeric",
                weekday: "long",
              })}
              <span className="mx-2 text-ink-faint">·</span>一天从凌晨 4 点开始计算
            </p>
          </div>
          {s && s.streak > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-warn-soft px-3 py-1.5 text-sm font-medium text-warn">
              <Flame size={15} />
              连续 {s.streak} 天
            </span>
          )}
        </header>

        {data.error && <Notice tone="error">{data.error}</Notice>}

        {/* 今日任务 */}
        <Card className="flex flex-wrap items-center gap-x-8 gap-y-5 p-6">
          <div className="flex items-center gap-5">
            <Ring pct={progress} />
            <div>
              <div className="text-xs text-ink-faint">今日任务</div>
              <div className="mt-1 text-lg font-semibold">
                {!s ? "正在加载…" : canStart ? `还剩 ${remaining} 个` : "今日任务已完成"}
              </div>
              <div className="mt-0.5 text-xs text-ink-soft">
                今天已练 {s?.doneToday ?? 0} 个句块
              </div>
            </div>
          </div>

          <div className="flex gap-8 border-line sm:border-l sm:pl-8">
            <div>
              <div className="text-[34px] leading-none font-semibold tabular-nums">
                {s?.newToday ?? "–"}
              </div>
              <div className="mt-1.5 text-xs text-ink-soft">新句块</div>
            </div>
            <div>
              <div className="text-[34px] leading-none font-semibold tabular-nums">
                {s?.dueToday ?? "–"}
              </div>
              <div className="mt-1.5 text-xs text-ink-soft">待复习</div>
            </div>
          </div>

          <div className="ml-auto flex min-w-56 flex-col gap-2">
            <Button
              variant="primary"
              size="lg"
              disabled={!canStart}
              onClick={() => navigate("/practice")}
            >
              <Play size={16} />
              开始学习
              {canStart && (
                <span className="ml-1 rounded-md bg-white/20 px-1.5 py-px text-[11px] font-medium">
                  Enter
                </span>
              )}
            </Button>
            <Button
              variant={canStart ? "secondary" : "soft"}
              disabled={extraCount === 0}
              title="在每日任务之外，多学当前词书里的新句块；不占用每日新句块数"
              onClick={() => navigate("/practice?extra=1")}
            >
              <Plus size={15} />
              {extraCount > 0 ? `额外练习 ${extraCount} 个` : "额外练习"}
            </Button>
          </div>
          {s && !canStart && book && book.fresh === 0 && (
            <p className="w-full text-xs text-ink-soft">
              这本书已经学完了，
              <Link to="/books" className="text-accent hover:underline">
                去词书里换一本
              </Link>
              吧。
            </p>
          )}
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.25fr_1fr]">
          {/* 当前词书 */}
          <Card className="flex gap-5 p-6">
            {book ? (
              <>
                <BookCover id={book.id} color={book.color} title={book.title} size="lg" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center justify-between text-xs text-ink-faint">
                    正在学
                    <Link to="/books" className="text-accent hover:underline">
                      换一本
                    </Link>
                  </div>
                  <h2 className="mt-0.5 text-xl font-semibold tracking-tight">{book.title}</h2>
                  <p className="mt-1.5 line-clamp-2 text-sm text-ink-soft">{book.description}</p>
                  <div className="mt-auto pt-4">
                    <div className="mb-1.5 flex justify-between text-xs text-ink-soft">
                      <span>
                        已学 {book.learned} / {book.total}
                      </span>
                      <span className="tabular-nums">
                        {book.total > 0 ? Math.round((book.learned / book.total) * 100) : 0}%
                      </span>
                    </div>
                    <ProgressBar value={book.learned} max={book.total} />
                  </div>
                </div>
              </>
            ) : (
              <div className="text-sm text-ink-soft">正在加载词书…</div>
            )}
          </Card>

          {/* 统计 */}
          <Card className="divide-y divide-line px-5 py-1">
            <Stat
              icon={<Clock size={15} />}
              label="今日学习"
              value={today ? minutes(today.studyMs) : undefined}
              unit="分钟"
            />
            <Stat icon={<Flame size={15} />} label="连续学习" value={s?.streak} unit="天" />
            <Stat
              icon={<Trophy size={15} />}
              label="已掌握"
              value={s?.mastered}
              unit={`/ ${s?.total ?? 0}`}
            />
          </Card>
        </div>

        {/* 最近 7 天 */}
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-sm font-medium">最近 7 天</h2>
            <span className="flex items-center gap-1 text-xs text-ink-soft">
              <CalendarCheck size={13} />
              完成当天开始时到期的全部复习，算作打卡一天
            </span>
          </div>
          <div className="grid grid-cols-7 gap-2">
            {week.map((d, i) => {
              const date = new Date(dayStart(d.day));
              const isToday = i === week.length - 1;
              return (
                <div
                  key={d.day}
                  className={cx(
                    "flex flex-col items-center gap-1.5 rounded-xl py-3",
                    isToday && "bg-accent-soft/60 ring-1 ring-accent/25",
                  )}
                >
                  <span className="text-[11px] text-ink-faint">
                    {isToday ? "今天" : `周${WEEKDAYS[date.getDay()]}`}
                  </span>
                  <span
                    className={cx(
                      "flex size-9 items-center justify-center rounded-full text-sm font-medium tabular-nums",
                      d.completed
                        ? "bg-good text-white"
                        : d.answered > 0
                          ? "bg-good-soft text-good ring-1 ring-good/30"
                          : "bg-ink/5 text-ink-faint",
                    )}
                  >
                    {date.getDate()}
                  </span>
                  <span className="text-[11px] text-ink-soft tabular-nums">
                    {d.studyMs > 0 ? `${minutes(d.studyMs)} 分钟` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}

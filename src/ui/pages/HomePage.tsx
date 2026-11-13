import { CheckCircle2, Clock, Flame, Play, Plus, Trophy } from "lucide-react";
import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { studyDay } from "../../core/srs/day";
import { currentBookId, listBooks } from "../../repo/books";
import { getSettings } from "../../repo/settings";
import { homeStats, recentDays } from "../../repo/stats";
import { EXTRA_COUNT } from "../../repo/study";
import { BookCover } from "../bookCover";
import { Button, Card, Notice, ProgressBar, cx } from "../components";
import { Heatmap, heatmapSpan } from "../Heatmap";
import { useAsync } from "../hooks";
import { useCountUp } from "../motion";
import { db } from "../services";

async function load() {
  const now = Date.now();
  const settings = await getSettings(db);
  const bookId = await currentBookId(db);
  const [stats, books, days] = await Promise.all([
    homeStats(db, settings.dailyNew, now, bookId),
    listBooks(db),
    recentDays(db, now, heatmapSpan(studyDay(now), 53)),
  ]);
  return {
    stats,
    book: books.find((b) => b.id === bookId) ?? null,
    days,
    dailyNew: settings.dailyNew,
  };
}

function minutes(ms: number): string {
  if (ms <= 0) return "0";
  return String(Math.max(1, Math.round(ms / 60000)));
}

/** 今日任务的环形进度 */
function Ring({ pct }: { pct: number }) {
  const percent = useCountUp(Math.round(pct * 100));
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
            "transition-[stroke-dashoffset] duration-1000 ease-out",
            pct >= 1 ? "stroke-good" : "stroke-accent",
          )}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {pct >= 1 ? (
          <CheckCircle2 size={26} className="animate-pop text-good" />
        ) : (
          <span className="text-lg font-semibold tabular-nums">{percent}%</span>
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
  value: number | undefined;
  unit?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
        {icon}
      </span>
      <span className="flex-1 text-sm text-ink-soft">{label}</span>
      <span className="text-lg font-semibold tabular-nums">
        {value === undefined ? "–" : <CountUp value={value} />}
        {unit && value !== undefined && (
          <span className="ml-1 text-xs font-normal text-ink-soft">{unit}</span>
        )}
      </span>
    </div>
  );
}

function CountUp({ value }: { value: number }) {
  return <>{useCountUp(value)}</>;
}

/** 首页（需求第 6 节） */
export default function HomePage() {
  const data = useAsync(load, []);
  const navigate = useNavigate();
  const s = data.data?.stats;
  const book = data.data?.book;
  const days = data.data?.days ?? [];
  const today = days.at(-1);
  const activeDays = days.filter((d) => d.answered > 0).length;
  const totalMinutes = Math.round(days.reduce((sum, d) => sum + d.studyMs, 0) / 60000);
  const canStart = s !== undefined && s.dueToday + s.newToday > 0;
  const extraCount = book ? Math.min(EXTRA_COUNT, book.fresh) : 0;
  const remaining = s ? s.dueToday + s.newToday : 0;
  // 今日任务完成度：今天已练的 / (已练 + 还剩)；没有任务时算完成
  const progress = !s
    ? 0
    : s.doneToday + remaining > 0
      ? Math.min(1, s.doneToday / (s.doneToday + remaining))
      : 1;

  // 首页按空格或 Enter 直接开始学习
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.key !== " " && e.key !== "Enter") ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.isComposing
      )
        return;
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
      <div className="stagger mx-auto flex w-full max-w-5xl flex-col gap-4 px-10 pt-9 pb-8">
        <header className="mb-3 flex items-end justify-between gap-4">
          <h1 className="text-[26px] font-semibold tracking-tight">今天</h1>
          {s && s.streak > 0 && (
            <span className="flex animate-pop items-center gap-1.5 rounded-full bg-warn-soft px-3 py-1.5 text-sm font-medium text-warn">
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
                今天已练 {s?.doneToday ?? 0} 个短语
              </div>
            </div>
          </div>

          <div className="flex gap-8 border-line sm:border-l sm:pl-8">
            <div>
              <div className="text-[34px] leading-none font-semibold tabular-nums">
                {s ? <CountUp value={s.newToday} /> : "–"}
              </div>
              <div className="mt-1.5 text-xs text-ink-soft">新短语</div>
            </div>
            <div>
              <div className="text-[34px] leading-none font-semibold tabular-nums">
                {s ? <CountUp value={s.dueToday} /> : "–"}
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
                  空格
                </span>
              )}
            </Button>
            <Button
              variant={canStart ? "secondary" : "soft"}
              disabled={extraCount === 0}
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
              value={today ? Number(minutes(today.studyMs)) : undefined}
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

        {/* 练习记录 */}
        <Card className="p-6">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 className="text-sm font-medium">练习记录</h2>
            {days.length > 0 && (
              <span className="text-xs text-ink-soft tabular-nums">
                一年来练习 {activeDays} 天 · 共 {totalMinutes} 分钟
              </span>
            )}
          </div>
          <Heatmap days={days} />
        </Card>
      </div>
    </div>
  );
}

/** 一轮练习结束时的小结（需求 5.7） */
import { CheckCircle2, Clock, Home, RotateCcw, Sparkles, Target } from "lucide-react";
import { Button, cx } from "../components";

export interface RoundStats {
  /** 学习时长（窗口在前台的时间），毫秒 */
  durationMs: number;
  /** 本轮新学的句块数（完成跟写的） */
  learned: number;
  /** 本轮完成的复习数 */
  reviewed: number;
  /** 有评分的作答次数（每个句块每个阶段只算第一次） */
  graded: number;
  /** 其中第一次就答对的 */
  correct: number;
  /** 答错过的句块 */
  wrong: Array<{ id: string; lemma: string; meaning: string }>;
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}

function Tile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-2xl bg-panel-muted px-3 py-4 ring-1 ring-line">
      <span className="text-accent">{icon}</span>
      <span className="text-xs text-ink-soft">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function Summary({
  stats,
  nothingToStudy,
  exitedEarly,
  extra,
  moreCount,
  onMore,
  onHome,
}: {
  stats: RoundStats;
  /** 这一轮一开始就没有题 */
  nothingToStudy: boolean;
  /** 中途退出，还有题没做 */
  exitedEarly: boolean;
  /** 这一轮是额外练习 */
  extra: boolean;
  /** “再练 N 个”的个数；0 表示当前词书没有新句块了 */
  moreCount: number;
  onMore: () => void;
  onHome: () => void;
}) {
  const empty = stats.graded === 0 && stats.learned === 0;
  const accuracy = stats.graded > 0 ? Math.round((stats.correct / stats.graded) * 100) : 100;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-canvas/70 p-6 backdrop-blur-sm">
      <section
        role="dialog"
        aria-label="本轮小结"
        className="w-full max-w-xl animate-rise rounded-3xl bg-panel p-8 shadow-float ring-1 ring-line"
      >
        <div className="text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            {empty ? <CheckCircle2 size={24} /> : <Sparkles size={24} />}
          </div>
          <h2 className="text-2xl font-semibold">
            {nothingToStudy
              ? "现在没有要学的内容"
              : empty || exitedEarly
                ? "本轮结束"
                : extra
                  ? "额外练习完成"
                  : "本轮完成"}
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            {nothingToStudy
              ? moreCount > 0
                ? extra
                  ? "当前词书没有可学的新句块了。"
                  : "今天的复习和新句块都完成了，可以额外再练一些新句块。"
                : "当前词书已经学完了，去词书里换一本吧。"
              : empty || exitedEarly
                ? "已完成的进度都保存了，剩下的下次继续。"
                : accuracy >= 90
                  ? "太棒了，继续保持！"
                  : "错的句块明天还会再出现，别担心。"}
          </p>
        </div>

        {!empty && (
          <div className="mt-6 grid grid-cols-4 gap-3">
            <Tile
              icon={<Clock size={18} />}
              label="学习时长"
              value={formatDuration(stats.durationMs)}
            />
            <Tile icon={<Target size={18} />} label="正确率" value={`${accuracy}%`} />
            <Tile icon={<Sparkles size={18} />} label="新学" value={String(stats.learned)} />
            <Tile icon={<RotateCcw size={18} />} label="复习" value={String(stats.reviewed)} />
          </div>
        )}

        {stats.wrong.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-xs font-medium text-ink-soft">答错的句块</h3>
            <ul className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
              {stats.wrong.map((w) => (
                <li
                  key={w.id}
                  title={w.meaning}
                  className="rounded-lg bg-bad-soft px-2.5 py-1 font-display text-sm text-bad"
                >
                  {w.lemma}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className={cx("mt-8 flex justify-center gap-3")}>
          {moreCount > 0 && (
            <Button variant="primary" size="lg" autoFocus onClick={onMore}>
              <Sparkles size={16} />
              再练 {moreCount} 个
            </Button>
          )}
          <Button size="lg" autoFocus={moreCount === 0} onClick={onHome}>
            <Home size={16} />
            回首页
          </Button>
        </div>
      </section>
    </div>
  );
}

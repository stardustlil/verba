/**
 * 练习（需求第 5 节），全屏专注模式。
 * 一轮 = 复习 → 新句块跟写 → 语境填空 → 纯中文默写，题目上直接打字，没有输入框。
 * 出题顺序、评级、调度等规则都在 core/srs，这里只管界面和流程。
 */
import { ArrowLeft, AudioLines, Keyboard, Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { copyProgress } from "../../core/judge/copy";
import { type WordMark, diffAnswer } from "../../core/judge/diff";
import { type JudgeTarget, clozeTargets, isCorrect, recallTargets } from "../../core/judge/judge";
import { studyDay } from "../../core/srs/day";
import { pickExample } from "../../core/srs/progress";
import {
  PHASES,
  PHASE_LABEL,
  type Phase,
  type QueueItem,
  afterAnswer,
  buildRound,
  phaseProgress,
  withoutChunk,
} from "../../core/srs/session";
import { currentBookId, freshCount } from "../../repo/books";
import {
  type DeletedChunk,
  softDeleteChunk,
  undoDeleteChunk,
  updateMeaning,
} from "../../repo/chunks";
import { getSettings, saveSettings } from "../../repo/settings";
import { addStudyTime } from "../../repo/stats";
import {
  type AnswerRecord,
  type StudyChunk,
  type StudyExample,
  EXTRA_COUNT,
  introduceChunk,
  loadStudyChunk,
  newAvailableToday,
  overrideAnswer,
  recordAnswer,
  sessionChunks,
} from "../../repo/study";
import { Button, Notice, TextInput, cx } from "../components";
import { focusedTextField, hasMod, isImeKey, modLabel } from "../keys";
import { db, errorMessage } from "../services";
import { playCorrect, playWrong, setSoundEnabled } from "../sound";
import { speak, speechSupported, stopSpeaking } from "../speech";
import { AnswerDiff, HintPill, Kbd, Sentence } from "./parts";
import { Stopwatch } from "./stopwatch";
import { type RoundStats, Summary } from "./Summary";
import { TypingLine } from "./TypingLine";

/** daily 每日任务（到期复习 + 今日额度内的新句块）；extra 额外练习（只学新句块，不占额度） */
export type RoundKind = "daily" | "extra";

type Mode = "copy" | "cloze" | "recall";

/**
 * typing 作答中（跟写时为照着打）；correct 答对（或跟写完成、改判）；
 * wrong 答错，要照着正确答案再打一遍；reveal 看了答案，要照着打一遍；
 * retyped 照着打完了，等待进入下一题
 */
type Status = "typing" | "correct" | "wrong" | "reveal" | "retyped";

interface Card {
  item: QueueItem;
  chunk: StudyChunk;
  mode: Mode;
  example: StudyExample | undefined;
  status: Status;
  record?: AnswerRecord;
  /** 答错时，用户的答案与正确答案的对比 */
  marks?: WordMark[];
  overridden?: boolean;
}

type View =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "card"; card: Card }
  | { kind: "summary" };

function modeFor(item: QueueItem, chunk: StudyChunk, example: StudyExample | undefined): Mode {
  if (item.phase === "copy" || chunk.progress.stage === "new") return "copy";
  if (item.phase === "cloze") return example ? "cloze" : "recall";
  if (item.phase === "recall") return "recall";
  return chunk.progress.stage === "recall" || !example ? "recall" : "cloze";
}

/** 这道题的标准答案：跟写、默写写原形，填空写原文形式 */
function answerOf(card: Card): string {
  return card.mode === "cloze" && card.example ? card.example.surface : card.chunk.lemma;
}

function targetsOf(card: Card): JudgeTarget[] {
  if (card.mode === "cloze" && card.example) return clozeTargets(card.example.surface);
  return recallTargets(card.chunk.lemma, card.chunk.altAnswers);
}

/** 选出最接近用户输入的答案来做对比 */
function bestDiff(input: string, targets: JudgeTarget[]): WordMark[] {
  let best: WordMark[] = [];
  let bestErrors = Infinity;
  for (const target of targets) {
    const marks = diffAnswer(input, target.text, target.slots);
    const errors = marks.filter((m) => m.kind !== "ok").length;
    if (errors < bestErrors) {
      best = marks;
      bestErrors = errors;
    }
  }
  return best;
}

/** 照着打（跟写、答错后重打、看答案后重打）还是自由作答 */
function isCopying(card: Card): boolean {
  return (
    card.mode === "copy" ||
    card.status === "wrong" ||
    card.status === "reveal" ||
    card.status === "retyped"
  );
}

function finished(card: Card): boolean {
  return card.status === "correct" || card.status === "retyped";
}

/** 把恢复的题插回各自阶段的末尾 */
function insertByPhase(queue: QueueItem[], items: QueueItem[]): QueueItem[] {
  let result = [...queue];
  for (const item of items) {
    const rank = PHASES.indexOf(item.phase);
    const at = result.findIndex((q) => PHASES.indexOf(q.phase) > rank);
    result = at < 0 ? [...result, item] : [...result.slice(0, at), item, ...result.slice(at)];
  }
  return result;
}

function emptyStats(): RoundStats {
  return { durationMs: 0, learned: 0, reviewed: 0, graded: 0, correct: 0, wrong: [] };
}

function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function PracticePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  /** 进入页面时要开始的一轮 */
  const firstKind = useRef<RoundKind>(params.get("extra") === "1" ? "extra" : "daily");
  const [kind, setKind] = useState<RoundKind>(firstKind.current);
  const [view, setView] = useState<View>({ kind: "loading" });
  const [typed, setTyped] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [typingSound, setTypingSound] = useState(true);
  const [moreAvailable, setMoreAvailable] = useState(0);
  const [showKeys, setShowKeys] = useState(false);
  const [, setTick] = useState(0);

  const queue = useRef<QueueItem[]>([]);
  const initial = useRef<QueueItem[]>([]);
  const deletedIds = useRef(new Set<string>());
  const undoStack = useRef<Array<{ deleted: DeletedChunk; item: QueueItem }>>([]);
  const answerWatch = useRef(new Stopwatch());
  const sessionWatch = useRef(new Stopwatch());
  const savedMs = useRef(0);
  const busy = useRef(false);
  const slowMs = useRef(30_000);
  const autoSpeakRef = useRef(true);
  const kindRef = useRef<RoundKind>(firstKind.current);
  const inputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const lastLemma = useRef<string | null>(null);
  /** 本轮是否中途退出（还有题没做完） */
  const exitedEarly = useRef(false);
  const stats = useRef<RoundStats>(emptyStats());
  /** 已评过分的“句块:阶段”，以及其中第一次答错的 */
  const graded = useRef(new Set<string>());
  const firstWrong = useRef(new Set<string>());

  const flash = useCallback((message: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  /** 把还没记下的学习时长记到今天 */
  const saveTime = useCallback(async () => {
    const total = sessionWatch.current.elapsed();
    const delta = total - savedMs.current;
    savedMs.current = total;
    await addStudyTime(db, studyDay(Date.now()), delta).catch(() => undefined);
  }, []);

  /** 显示队首的题；队列空了就显示小结 */
  const showHead = useCallback(
    async (next: QueueItem[]) => {
      let rest = next;
      for (;;) {
        queue.current = rest;
        const [head] = rest;
        if (!head) {
          sessionWatch.current.pause();
          stats.current.durationMs = sessionWatch.current.elapsed();
          await saveTime();
          setMoreAvailable(await freshCount(db, await currentBookId(db)));
          setView({ kind: "summary" });
          return;
        }
        const chunk = await loadStudyChunk(db, head.chunkId);
        if (!chunk) {
          rest = rest.slice(1);
          continue;
        }
        const example = pickExample(chunk.examples, chunk.progress.exampleCursor);
        const mode = modeFor(head, chunk, example);
        sessionWatch.current.resume();
        setTyped("");
        setEditing(null);
        answerWatch.current.reset();
        setView({ kind: "card", card: { item: head, chunk, mode, example, status: "typing" } });
        if (mode === "copy" && autoSpeakRef.current) speak(chunk.lemma);
        return;
      }
    },
    [saveTime],
  );

  const start = useCallback(
    async (roundKind: RoundKind) => {
      setView({ kind: "loading" });
      setKind(roundKind);
      kindRef.current = roundKind;
      stats.current = emptyStats();
      graded.current = new Set();
      firstWrong.current = new Set();
      deletedIds.current = new Set();
      lastLemma.current = null;
      exitedEarly.current = false;
      sessionWatch.current.reset();
      sessionWatch.current.start();
      savedMs.current = 0;
      try {
        const settings = await getSettings(db);
        slowMs.current = settings.slowSeconds * 1000;
        autoSpeakRef.current = settings.autoSpeak;
        setAutoSpeak(settings.autoSpeak);
        setSoundEnabled(settings.typingSound);
        setTypingSound(settings.typingSound);
        const now = Date.now();
        const extra = roundKind === "extra";
        const count = extra ? EXTRA_COUNT : await newAvailableToday(db, settings.dailyNew, now);
        const { dueIds, newIds } = await sessionChunks(db, count, now, { extra });
        const round = buildRound(dueIds, newIds);
        initial.current = round;
        await showHead(round);
      } catch (e) {
        setView({ kind: "error", message: errorMessage(e) });
      }
    },
    [showHead],
  );

  useEffect(() => {
    void start(firstKind.current);
  }, [start]);

  // 离开页面时记下学习时长、停止朗读
  useEffect(() => {
    const watch = sessionWatch.current;
    return () => {
      stopSpeaking();
      const delta = watch.elapsed() - savedMs.current;
      savedMs.current = watch.elapsed();
      void addStudyTime(db, studyDay(Date.now()), delta).catch(() => undefined);
    };
  }, []);

  // 窗口失去焦点时暂停计时；回来时恢复。顺便每秒刷新一次底栏的用时。
  useEffect(() => {
    const pause = () => {
      answerWatch.current.pause();
      sessionWatch.current.pause();
    };
    const resume = () => {
      answerWatch.current.resume();
      sessionWatch.current.resume();
    };
    window.addEventListener("blur", pause);
    window.addEventListener("focus", resume);
    const timer = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      window.removeEventListener("blur", pause);
      window.removeEventListener("focus", resume);
      window.clearInterval(timer);
    };
  }, []);

  // 光标始终在打字行上
  useEffect(() => {
    if (view.kind === "card" && editing === null) inputRef.current?.focus();
  }, [view, editing]);

  /** 执行一个会读写数据库的动作；进行中忽略重复触发 */
  const run = useCallback(async (action: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      busy.current = false;
    }
  }, []);

  const card = view.kind === "card" ? view.card : null;
  const setCard = (next: Card) => setView({ kind: "card", card: next });

  /** 记一次有评分的作答；每个句块每个阶段只算第一次 */
  const grade = (c: Card, correct: boolean) => {
    const key = `${c.chunk.id}:${c.item.phase}`;
    if (!graded.current.has(key)) {
      graded.current.add(key);
      stats.current.graded++;
      if (correct) stats.current.correct++;
      else firstWrong.current.add(key);
      if (c.item.phase === "review") stats.current.reviewed++;
    }
    if (!correct && !stats.current.wrong.some((w) => w.id === c.chunk.id)) {
      stats.current.wrong.push({ id: c.chunk.id, lemma: c.chunk.lemma, meaning: c.chunk.meaning });
    }
  };

  /** “我写的也对”之后，把这次算作答对 */
  const regrade = (c: Card) => {
    const key = `${c.chunk.id}:${c.item.phase}`;
    if (firstWrong.current.delete(key)) stats.current.correct++;
    stats.current.wrong = stats.current.wrong.filter((w) => w.id !== c.chunk.id);
  };

  const sayAnswer = (c: Card) => {
    if (!autoSpeakRef.current) return;
    speak(c.mode === "cloze" && c.example ? c.example.sentence : c.chunk.lemma);
  };

  const onType = (value: string) => {
    if (!card || finished(card) || editing !== null) return;
    setTyped(value);
    if (card.mode !== "copy" && card.status === "typing" && value.length > 0) {
      answerWatch.current.start();
    }
    if (!isCopying(card) || !copyProgress(answerOf(card), value).complete) return;
    // 照着打完了
    if (card.mode === "copy" && card.status === "typing") {
      void run(async () => {
        await introduceChunk(db, card.chunk.id, Date.now(), kindRef.current === "extra");
        playCorrect();
        stats.current.learned++;
        setCard({ ...card, status: "correct" });
      });
    } else if (card.status === "reveal") {
      void run(async () => {
        await recordAnswer(db, {
          chunkId: card.chunk.id,
          mode: card.mode === "cloze" ? "cloze" : "recall",
          exampleId: card.mode === "cloze" ? (card.example?.id ?? null) : null,
          input: value,
          correct: true,
          viewedAnswer: true,
          durationMs: answerWatch.current.elapsed(),
          slowMs: slowMs.current,
          now: Date.now(),
        });
        grade(card, false);
        setCard({ ...card, status: "retyped" });
      });
    } else if (card.status === "wrong") {
      setCard({ ...card, status: "retyped" });
    }
  };

  const submit = () =>
    run(async () => {
      if (!card || card.mode === "copy" || card.status !== "typing" || !typed.trim()) return;
      answerWatch.current.pause();
      const targets = targetsOf(card);
      const correct = isCorrect(typed, targets);
      const record = await recordAnswer(db, {
        chunkId: card.chunk.id,
        mode: card.mode,
        exampleId: card.mode === "cloze" ? (card.example?.id ?? null) : null,
        input: typed,
        correct,
        viewedAnswer: false,
        durationMs: answerWatch.current.elapsed(),
        slowMs: slowMs.current,
        now: Date.now(),
      });
      grade(card, correct);
      sayAnswer(card);
      if (correct) playCorrect();
      else playWrong();
      if (correct) {
        setCard({ ...card, status: "correct", record });
      } else {
        setCard({ ...card, status: "wrong", record, marks: bestDiff(typed, targets) });
        setTyped("");
      }
    });

  const reveal = () => {
    if (!card || card.mode === "copy" || card.status !== "typing") return;
    answerWatch.current.pause();
    setTyped("");
    setCard({ ...card, status: "reveal" });
    sayAnswer(card);
  };

  const next = () =>
    run(async () => {
      if (!card || !finished(card)) return;
      lastLemma.current = card.chunk.lemma;
      await showHead(afterAnswer(queue.current, card.status === "correct"));
    });

  const override = () =>
    run(async () => {
      if (!card || card.mode === "copy" || !card.record || card.overridden) return;
      if (card.status !== "wrong" && card.status !== "retyped") return;
      await overrideAnswer(db, card.record, Date.now());
      regrade(card);
      setTyped(answerOf(card));
      setCard({ ...card, status: "correct", overridden: true });
      flash(
        card.mode === "recall"
          ? "已改判为正确，这种写法已存为备选答案"
          : "已改判为正确（语境填空只改判本次）",
      );
    });

  const deleteCurrent = () =>
    run(async () => {
      if (!card) return;
      const deleted = await softDeleteChunk(db, card.chunk.id);
      undoStack.current.push({ deleted, item: card.item });
      deletedIds.current.add(card.chunk.id);
      stats.current.wrong = stats.current.wrong.filter((w) => w.id !== card.chunk.id);
      flash(`已删除“${card.chunk.lemma}”，按 ${modLabel("Z")} 撤销`);
      await showHead(withoutChunk(queue.current, card.chunk.id));
    });

  const undoDelete = () =>
    run(async () => {
      const last = undoStack.current.pop();
      if (!last) return;
      await undoDeleteChunk(db, last.deleted);
      deletedIds.current.delete(last.deleted.chunkId);
      // 恢复这个句块在本轮中后面的阶段
      const rank = PHASES.indexOf(last.item.phase);
      const later = initial.current.filter(
        (i) => i.chunkId === last.deleted.chunkId && PHASES.indexOf(i.phase) > rank,
      );
      flash("已撤销删除");
      await showHead([last.item, ...insertByPhase(queue.current, later)]);
    });

  const startEdit = () => {
    if (!card || editing !== null) return;
    answerWatch.current.pause();
    setEditing(card.chunk.meaning);
  };

  const cancelEdit = () => {
    setEditing(null);
    answerWatch.current.resume();
  };

  const saveEdit = () =>
    run(async () => {
      if (!card || editing === null) return;
      const meaning = editing.trim();
      if (!meaning) return;
      await updateMeaning(db, card.chunk.id, meaning);
      for (const w of stats.current.wrong) if (w.id === card.chunk.id) w.meaning = meaning;
      setCard({ ...card, chunk: { ...card.chunk, meaning } });
      setEditing(null);
      answerWatch.current.resume();
    });

  const toggleSpeak = () =>
    run(async () => {
      const value = !autoSpeakRef.current;
      autoSpeakRef.current = value;
      setAutoSpeak(value);
      if (!value) stopSpeaking();
      await saveSettings(db, { autoSpeak: value });
    });

  const toggleSound = () =>
    run(async () => {
      const value = !typingSound;
      setTypingSound(value);
      setSoundEnabled(value);
      await saveSettings(db, { typingSound: value });
    });

  /** ⌘P 朗读。作答中只读跟写的句块，免得泄露答案 */
  const speakNow = () => {
    if (!card) return;
    if (card.mode === "copy") speak(card.chunk.lemma);
    else if (card.status !== "typing") sayAnswerNow(card);
  };
  const sayAnswerNow = (c: Card) =>
    speak(c.mode === "cloze" && c.example ? c.example.sentence : c.chunk.lemma);

  const exit = () => {
    if (view.kind === "summary" || view.kind === "error") {
      navigate("/");
      return;
    }
    exitedEarly.current = queue.current.length > 0;
    void showHead([]);
  };

  // 快捷键（需求 5.8）。监听在 window 上，焦点在哪里都能用。
  const onKey = (e: KeyboardEvent) => {
    if (editing !== null) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
      } else if (e.key === "Enter" && !isImeKey(e)) {
        e.preventDefault();
        void saveEdit();
      }
      return;
    }
    const mod = hasMod(e);
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (view.kind === "summary") {
      if (key === "Escape") {
        e.preventDefault();
        navigate("/");
      } else if (mod && key === "z" && undoStack.current.length > 0) {
        e.preventDefault();
        void undoDelete();
      }
      return;
    }
    if (isImeKey(e)) return;

    if (mod && key === "z" && !e.shiftKey) {
      const field = focusedTextField();
      if ((!field || field.value === "") && undoStack.current.length > 0) {
        e.preventDefault();
        void undoDelete();
      }
      return;
    }
    if (mod && key === "e") {
      e.preventDefault();
      startEdit();
      return;
    }
    if (mod && key === "d") {
      e.preventDefault();
      void deleteCurrent();
      return;
    }
    if (mod && key === "p") {
      e.preventDefault();
      speakNow();
      return;
    }
    if (mod && key === "Enter") {
      e.preventDefault();
      void override();
      return;
    }
    if (key === "Escape") {
      e.preventDefault();
      exit();
      return;
    }
    if (mod || e.altKey || !card) return;

    if (key === "Enter") {
      e.preventDefault();
      if (finished(card)) void next();
      else if (card.status === "typing" && card.mode !== "copy") void submit();
      return;
    }
    if (key === " " && finished(card)) {
      e.preventDefault();
      void next();
      return;
    }
    if (key === "Tab") {
      e.preventDefault();
      reveal();
    }
  };
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, []);

  const progress = phaseProgress(initial.current, queue.current, deletedIds.current);
  const currentPhase: Phase | null = card?.item.phase ?? null;
  const phaseNow = progress.find((p) => p.phase === currentPhase);

  return (
    <div className="flex h-full flex-col bg-canvas">
      {/* 顶栏：上一题、当前阶段、退出 */}
      <header className="grid h-14 shrink-0 grid-cols-3 items-center px-6 text-sm">
        <div className="flex min-w-0 items-center gap-2 text-ink-faint">
          {lastLemma.current && card && (
            <>
              <ArrowLeft size={14} className="shrink-0" />
              <span className="truncate font-display">{lastLemma.current}</span>
            </>
          )}
        </div>
        <div className="flex justify-center">
          {card && phaseNow && (
            <span className="rounded-full bg-panel px-3 py-1 text-xs font-medium text-ink-soft ring-1 ring-line">
              {kind === "extra" && <span className="mr-1.5 text-accent">额外练习</span>}
              {PHASE_LABEL[card.item.phase]}
              <span className="ml-1.5 text-ink-faint tabular-nums">
                {phaseNow.done} / {phaseNow.total}
              </span>
              {card.item.retry && <span className="ml-1.5 text-warn">重出</span>}
            </span>
          )}
        </div>
        <div className="flex justify-end">
          {view.kind !== "summary" && (
            <Button variant="ghost" size="sm" onClick={exit} aria-label="退出本轮">
              <X size={14} />
              退出
              <Kbd>Esc</Kbd>
            </Button>
          )}
        </div>
      </header>

      {/* 题目 */}
      <main
        className="relative flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-8"
        onMouseDown={(e) => {
          if (editing === null && e.target === e.currentTarget) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        <div className="my-auto flex w-full max-w-3xl flex-col items-center py-10">
          {error && (
            <div className="mb-6 w-full">
              <Notice tone="error">{error}</Notice>
            </div>
          )}
          {view.kind === "loading" && <p className="text-sm text-ink-faint">正在准备…</p>}
          {view.kind === "error" && <Notice tone="error">{view.message}</Notice>}
          {card && (
            <CardView
              key={`${card.chunk.id}:${card.item.phase}:${card.item.retry ? "r" : ""}`}
              card={card}
              typed={typed}
              onType={onType}
              inputRef={inputRef}
              editing={editing}
              setEditing={setEditing}
              composing={composing}
              onComposingChange={setComposing}
            />
          )}
        </div>

        {toast && (
          <div
            role="status"
            className="pointer-events-none fixed bottom-28 left-1/2 -translate-x-1/2 animate-rise rounded-xl bg-ink px-4 py-2 text-sm text-canvas shadow-float"
          >
            {toast}
          </div>
        )}
      </main>

      {/* 底栏：各阶段进度、用时、朗读、快捷键 */}
      {view.kind !== "loading" && view.kind !== "error" && (
        <footer className="mx-auto mb-5 w-full max-w-3xl shrink-0 px-8">
          <div className="flex items-center gap-5 rounded-2xl bg-panel px-5 py-3 shadow-card ring-1 ring-line">
            <div className="flex min-w-0 flex-1 gap-2">
              {progress.map((p) => (
                <div key={p.phase} className="min-w-0 flex-1">
                  <div className="h-1.5 overflow-hidden rounded-full bg-ink/8">
                    <div
                      className={cx(
                        "h-full rounded-full transition-[width] duration-300",
                        p.phase === currentPhase ? "bg-accent" : "bg-accent/45",
                      )}
                      style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }}
                    />
                  </div>
                  <div
                    className={cx(
                      "mt-1.5 flex justify-between text-[11px]",
                      p.phase === currentPhase ? "font-medium text-ink" : "text-ink-faint",
                    )}
                  >
                    <span>{PHASE_LABEL[p.phase]}</span>
                    <span className="tabular-nums">
                      {p.done}/{p.total}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <span className="w-12 text-right text-xs text-ink-soft tabular-nums" title="本轮用时">
              {formatClock(sessionWatch.current.elapsed())}
            </span>
            {speechSupported && (
              <button
                type="button"
                title={autoSpeak ? "自动朗读：开" : "自动朗读：关"}
                aria-label="自动朗读"
                aria-pressed={autoSpeak}
                className={cx(
                  "rounded-lg p-1.5 transition-colors",
                  autoSpeak ? "text-accent hover:bg-accent-soft" : "text-ink-faint hover:bg-ink/5",
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void toggleSpeak()}
              >
                {autoSpeak ? <Volume2 size={17} /> : <VolumeX size={17} />}
              </button>
            )}
            <button
              type="button"
              title={typingSound ? "打字音效：开" : "打字音效：关"}
              aria-label="打字音效"
              aria-pressed={typingSound}
              className={cx(
                "rounded-lg p-1.5 transition-colors",
                typingSound ? "text-accent hover:bg-accent-soft" : "text-ink-faint hover:bg-ink/5",
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void toggleSound()}
            >
              <AudioLines size={17} className={cx(!typingSound && "opacity-60")} />
            </button>
            <div className="relative">
              <button
                type="button"
                title="快捷键"
                aria-label="快捷键"
                className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-ink/5 hover:text-ink"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setShowKeys((v) => !v)}
              >
                <Keyboard size={17} />
              </button>
              {showKeys && <ShortcutPanel />}
            </div>
          </div>
        </footer>
      )}

      {view.kind === "summary" && (
        <Summary
          stats={stats.current}
          nothingToStudy={initial.current.length === 0}
          exitedEarly={exitedEarly.current}
          extra={kind === "extra"}
          moreCount={Math.min(EXTRA_COUNT, moreAvailable)}
          onMore={() => void start("extra")}
          onHome={() => navigate("/")}
        />
      )}
    </div>
  );
}

function ShortcutPanel() {
  const rows: Array<[string, string]> = [
    ["Enter", "提交 / 下一题"],
    ["空格", "答完后下一题"],
    ["Tab", "看答案"],
    [modLabel("Enter"), "我写的也对"],
    [modLabel("E"), "修改释义"],
    [modLabel("D"), "删除句块"],
    [modLabel("Z"), "撤销删除"],
    [modLabel("P"), "朗读"],
    ["Esc", "结束本轮"],
  ];
  return (
    <div className="absolute right-0 bottom-10 z-20 w-56 animate-rise rounded-2xl bg-panel p-3 shadow-float ring-1 ring-line">
      {rows.map(([key, label]) => (
        <div
          key={key}
          className="flex items-center justify-between px-1 py-1 text-xs text-ink-soft"
        >
          <span>{label}</span>
          <Kbd>{key}</Kbd>
        </div>
      ))}
    </div>
  );
}

function Meaning({
  meaning,
  editing,
  setEditing,
  className,
}: {
  meaning: string;
  editing: string | null;
  setEditing: (value: string) => void;
  className?: string;
}) {
  if (editing === null) return <p className={className}>{meaning}</p>;
  return (
    <TextInput
      autoFocus
      aria-label="中文释义"
      value={editing}
      onChange={(e) => setEditing(e.target.value)}
      className="max-w-md text-center text-base"
    />
  );
}

function SpeakButton({ text }: { text: string }) {
  if (!speechSupported) return null;
  return (
    <button
      type="button"
      aria-label="朗读"
      title={`朗读（${modLabel("P")}）`}
      className="rounded-full p-1.5 text-ink-faint transition-colors hover:bg-accent-soft hover:text-accent"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => speak(text)}
    >
      <Volume2 size={18} />
    </button>
  );
}

function CardView({
  card,
  typed,
  onType,
  inputRef,
  editing,
  setEditing,
  composing,
  onComposingChange,
}: {
  card: Card;
  typed: string;
  onType: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  editing: string | null;
  setEditing: (value: string) => void;
  composing: boolean;
  onComposingChange: (composing: boolean) => void;
}) {
  const { chunk, example, mode, status } = card;
  const answer = answerOf(card);
  const done = finished(card);
  /** 答案是否已经可以给用户看了 */
  const answered = mode === "copy" || status !== "typing";

  const line = (
    <TypingLine
      mode={isCopying(card) ? "copy" : "free"}
      target={answer}
      value={typed}
      onChange={onType}
      inputRef={inputRef}
      tone={status === "correct" ? "good" : "neutral"}
      readOnly={done || editing !== null}
      size={mode === "cloze" ? "inline" : "hero"}
      onComposingChange={onComposingChange}
      ariaLabel="你的答案"
    />
  );

  let hint: React.ReactNode;
  if (composing) hint = <span className="text-warn">正在用输入法组字，请切换到英文输入</span>;
  else if (done)
    hint = (
      <>
        <Kbd>Enter</Kbd> 或 <Kbd>空格</Kbd> 下一题
      </>
    );
  else if (status === "wrong")
    hint = (
      <>
        照着正确答案再打一遍 · <Kbd>{modLabel("Enter")}</Kbd> 我写的也对
      </>
    );
  else if (status === "reveal") hint = <>照着答案打一遍</>;
  else if (mode === "copy") hint = <>照着打一遍</>;
  else
    hint = (
      <>
        <Kbd>Enter</Kbd> 提交 · <Kbd>Tab</Kbd> 看答案
      </>
    );

  const exampleBlock = example && (
    <div className="w-full max-w-2xl animate-rise space-y-1.5 border-t border-line pt-6 text-center">
      <div className="flex items-start justify-center gap-1">
        <Sentence
          text={example.sentence}
          start={example.start}
          length={example.surface.length}
          className="text-lg text-ink"
        />
        <SpeakButton text={example.sentence} />
      </div>
      {example.translation && <p className="text-sm text-ink-soft">{example.translation}</p>}
      <p className="text-xs text-ink-faint">出自《{example.sourceTitle}》</p>
    </div>
  );

  return (
    <section className="flex w-full flex-col items-center gap-7 text-center">
      {mode === "copy" && (
        <>
          <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-medium text-accent-ink">
            新句块
          </span>
          <div className="-mt-3 flex items-center gap-2">
            {line}
            <SpeakButton text={chunk.lemma} />
          </div>
          <Meaning
            meaning={chunk.meaning}
            editing={editing}
            setEditing={setEditing}
            className="-mt-2 text-lg text-ink-soft"
          />
          <HintPill>{hint}</HintPill>
          {exampleBlock}
        </>
      )}

      {mode === "recall" && (
        <>
          <Meaning
            meaning={chunk.meaning}
            editing={editing}
            setEditing={setEditing}
            className="text-[1.65rem] font-medium text-ink"
          />
          <div className="flex min-h-16 items-center gap-2">
            {line}
            {answered && <SpeakButton text={answer} />}
          </div>
          <HintPill>{hint}</HintPill>
        </>
      )}

      {mode === "cloze" && example && (
        <>
          <Sentence
            text={example.sentence}
            start={example.start}
            length={example.surface.length}
            slot={line}
            className="max-w-2xl text-[1.45rem] text-ink"
          />
          <div className="flex items-baseline gap-2 text-ink-soft">
            <span className="text-xs text-ink-faint">提示</span>
            <Meaning
              meaning={chunk.meaning}
              editing={editing}
              setEditing={setEditing}
              className="text-lg"
            />
          </div>
          <HintPill>{hint}</HintPill>
        </>
      )}

      {(status === "wrong" || (status === "retyped" && card.marks)) && card.marks && (
        <div className="w-full max-w-xl animate-rise space-y-1 rounded-2xl bg-bad-soft px-5 py-3 text-center">
          <div className="text-xs text-ink-soft">你写的是</div>
          <AnswerDiff marks={card.marks} className="text-xl" />
        </div>
      )}

      {status === "correct" && card.overridden && <p className="text-sm text-good">已改判为正确</p>}

      {mode !== "copy" && answered && (
        <div className="flex w-full flex-col items-center gap-4">
          {mode === "cloze" && (
            <p className="text-sm text-ink-soft">
              原形 <span className="font-display text-base text-ink">{chunk.lemma}</span>
              {example?.translation && <span className="ml-3">{example.translation}</span>}
            </p>
          )}
          {mode === "recall" && chunk.altAnswers.length > 0 && (
            <p className="text-sm text-ink-soft">也可写作：{chunk.altAnswers.join("；")}</p>
          )}
          {mode === "recall" && exampleBlock}
        </div>
      )}
    </section>
  );
}

/**
 * 导入流程的状态。放在应用顶层，这样抽取进行中切换到别的页面也不会中断。
 */
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { normalizeArticleText } from "../../core/text/clean";
import { createArticle, paragraphsOf } from "../../repo/articles";
import { type ImportSummary, runExtraction } from "../../repo/importer";
import { ai, db, errorMessage } from "../services";
import type { Draft } from "./importSource";

export type ImportState =
  | { step: "input" }
  | {
      step: "preview";
      draft: Draft;
      /** 选中要抽取短语的段落编号 */
      selected: ReadonlySet<number>;
      error: string | null;
      saving: boolean;
    }
  | {
      step: "running";
      articleId: string;
      title: string;
      done: number;
      total: number;
      previous: ImportSummary | null;
    }
  | {
      step: "done";
      articleId: string;
      title: string;
      /** null 表示只保存了文章，没有抽取 */
      summary: ImportSummary | null;
    };

interface ImportApi {
  state: ImportState;
  openDraft: (draft: Draft) => void;
  setTitle: (title: string) => void;
  /** 用户编辑正文后调用：重新整理正文，选中范围重置为全部 */
  setText: (text: string) => void;
  setSelected: (selected: ReadonlySet<number>) => void;
  /** 保存文章；extract 为 true 时接着抽取短语 */
  save: (extract: boolean) => Promise<void>;
  retryFailed: () => Promise<void>;
  reset: () => void;
}

const Context = createContext<ImportApi | null>(null);

function allParagraphs(text: string): ReadonlySet<number> {
  return new Set(paragraphsOf(text).map((_, i) => i));
}

function combine(previous: ImportSummary | null, next: ImportSummary): ImportSummary {
  if (!previous) return next;
  return {
    added: previous.added + next.added,
    merged: previous.merged + next.merged,
    batches: previous.batches,
    failedBatches: next.failedBatches,
    firstError: next.firstError,
  };
}

export function ImportProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ImportState>({ step: "input" });
  const stateRef = useRef(state);
  stateRef.current = state;

  const extract = useCallback(
    async (articleId: string, title: string, total: number, previous: ImportSummary | null) => {
      setState({ step: "running", articleId, title, done: 0, total, previous });
      let summary: ImportSummary;
      try {
        summary = await runExtraction(db, ai, articleId, {
          onProgress: (done, all) =>
            setState((s) => (s.step === "running" ? { ...s, done, total: all } : s)),
        });
      } catch (error) {
        summary = {
          added: 0,
          merged: 0,
          batches: total,
          failedBatches: total,
          firstError: errorMessage(error),
        };
      }
      setState({ step: "done", articleId, title, summary: combine(previous, summary) });
    },
    [],
  );

  const api = useMemo<ImportApi>(
    () => ({
      state,
      openDraft: (draft) =>
        setState({
          step: "preview",
          draft,
          selected: allParagraphs(draft.text),
          error: null,
          saving: false,
        }),
      setTitle: (title) =>
        setState((s) => (s.step === "preview" ? { ...s, draft: { ...s.draft, title } } : s)),
      setText: (raw) =>
        setState((s) => {
          if (s.step !== "preview") return s;
          const text = normalizeArticleText(raw);
          if (text === s.draft.text) return s;
          // 正文变了，原先记录的断词位置不再准确
          return { ...s, draft: { ...s.draft, text, joins: [] }, selected: allParagraphs(text) };
        }),
      setSelected: (selected) => setState((s) => (s.step === "preview" ? { ...s, selected } : s)),
      save: async (wantExtract) => {
        const current = stateRef.current;
        if (current.step !== "preview" || current.saving) return;
        const title = current.draft.title.trim() || "未命名文章";
        setState({ ...current, saving: true, error: null });
        try {
          const { articleId, batchCount } = await createArticle(db, {
            title,
            sourceType: current.draft.sourceType,
            sourceRef: current.draft.sourceRef,
            text: current.draft.text,
            selectedParagraphs: current.selected,
          });
          if (wantExtract && batchCount > 0) await extract(articleId, title, batchCount, null);
          else setState({ step: "done", articleId, title, summary: null });
        } catch (error) {
          setState({ ...current, saving: false, error: errorMessage(error) });
        }
      },
      retryFailed: async () => {
        const current = stateRef.current;
        if (current.step !== "done" || !current.summary) return;
        await extract(
          current.articleId,
          current.title,
          current.summary.failedBatches,
          current.summary,
        );
      },
      reset: () => setState({ step: "input" }),
    }),
    [state, extract],
  );

  return <Context.Provider value={api}>{children}</Context.Provider>;
}

export function useImport(): ImportApi {
  const api = useContext(Context);
  if (!api) throw new Error("useImport 必须在 ImportProvider 内使用");
  return api;
}

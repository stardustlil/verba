/**
 * 文章详情（需求 7.2、7.3）：原文中的句块高亮，点击查看、编辑；
 * 选中文字手动添加句块；删除文章。
 */
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { lemmaKey } from "../../core/judge/normalize";
import { splitParagraphs } from "../../core/text/segment";
import { countChunksOnlyIn, deleteArticle } from "../../repo/articles";
import { updateMeaning } from "../../repo/chunks";
import { runExtraction } from "../../repo/importer";
import {
  type ArticleDetail,
  type ArticleHighlight,
  type ArticleSentence,
  type SameLemmaChunk,
  addManualChunk,
  articleDetail,
  chunksWithLemma,
} from "../../repo/library";
import { Button, Dialog, Field, Modal, Notice, TextInput, cx } from "../components";
import { StatusBadge, formatDate } from "../format";
import { useAsync } from "../hooks";
import { ai, db, errorMessage, getApiKeyMasked } from "../services";
import {
  type Span,
  segmentParagraph,
  selectionSpan,
  sentenceContaining,
  snapToWords,
  trimSpan,
} from "./segments";

interface Selected {
  sentence: ArticleSentence;
  span: Span;
  surface: string;
}

export default function ArticleDetailPage() {
  const { id = "" } = useParams();
  const article = useAsync(() => articleDetail(db, id), [id]);
  const apiKey = useAsync(getApiKeyMasked, []);
  const navigate = useNavigate();

  const [active, setActive] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selected | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Selected | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [extracting, setExtracting] = useState<{ done: number; total: number } | null>(null);
  const textRef = useRef<HTMLDivElement>(null);

  const data = article.data;

  const readSelection = () => {
    if (!data || !textRef.current) return;
    const raw = selectionSpan(textRef.current);
    if (!raw) {
      setSelection(null);
      setSelectionError(null);
      return;
    }
    const trimmed = trimSpan(data.text, raw);
    const span = trimmed && snapToWords(data.text, trimmed);
    if (!span) {
      setSelection(null);
      return;
    }
    const sentence = sentenceContaining(data.sentences, span);
    if (!sentence) {
      setSelection(null);
      setSelectionError("请在一个句子之内选择文字。");
      return;
    }
    setSelectionError(null);
    setSelection({ sentence, span, surface: data.text.slice(span.start, span.end) });
  };

  const extract = async () => {
    if (!data) return;
    setMessage(null);
    setExtracting({ done: 0, total: data.unfinishedBatches });
    try {
      const summary = await runExtraction(db, ai, data.id, {
        onProgress: (done, total) => setExtracting({ done, total }),
      });
      const parts = [`已添加 ${summary.added} 个新句块`];
      if (summary.merged > 0) parts.push(`${summary.merged} 个合并为例句`);
      if (summary.failedBatches > 0)
        parts.push(`${summary.failedBatches} 批失败（${summary.firstError ?? "未知错误"}）`);
      setMessage({
        tone: summary.failedBatches > 0 ? "error" : "success",
        text: parts.join("，") + "。",
      });
    } catch (e) {
      setMessage({ tone: "error", text: errorMessage(e) });
    } finally {
      setExtracting(null);
      article.reload();
    }
  };

  if (article.error) {
    return (
      <div className="p-8">
        <Notice tone="error">{article.error}</Notice>
      </div>
    );
  }
  if (article.loading && !data) return null;
  if (!data) {
    return (
      <div className="space-y-4 p-8">
        <Notice tone="error">文章不存在或已删除。</Notice>
        <Link to="/articles" className="text-sm text-accent hover:underline">
          返回文章列表
        </Link>
      </div>
    );
  }

  const activeHighlight = data.highlights.find((h) => h.chunkId === active) ?? null;
  const chunkCount = new Set(data.highlights.map((h) => h.chunkId)).size;

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-line px-8 py-5">
          <div className="min-w-0">
            <Link to="/articles" className="text-xs text-ink-soft hover:text-accent">
              ← 文章
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-ink">{data.title}</h1>
            <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-soft">
              <span>{formatDate(data.createdAt)} 导入</span>
              {data.sourceType === "url" && data.sourceRef ? (
                <button
                  type="button"
                  className="max-w-80 truncate text-accent hover:underline"
                  title={data.sourceRef}
                  onClick={() => void openUrl(data.sourceRef ?? "").catch(() => undefined)}
                >
                  {data.sourceRef}
                </button>
              ) : (
                <span>{data.sourceType === "file" ? data.sourceRef : "粘贴"}</span>
              )}
              <span>{chunkCount} 个句块</span>
            </div>
          </div>
          <Button
            variant="ghost"
            className="shrink-0 text-bad"
            onClick={() =>
              void countChunksOnlyIn(db, data.id)
                .then(setConfirmDelete)
                .catch((e: unknown) => setMessage({ tone: "error", text: errorMessage(e) }))
            }
          >
            删除文章
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto max-w-2xl space-y-4">
            {message && <Notice tone={message.tone}>{message.text}</Notice>}
            {data.unfinishedBatches > 0 && !extracting && (
              <Notice tone="warning">
                <div className="flex items-center justify-between gap-4">
                  <span>
                    有 {data.unfinishedBatches} 批选中的段落还没有抽取句块
                    {!apiKey.loading && !apiKey.data && "。在设置中填写 API key 后可以抽取"}。
                  </span>
                  {apiKey.data && (
                    <Button className="shrink-0" onClick={() => void extract()}>
                      抽取句块
                    </Button>
                  )}
                </div>
              </Notice>
            )}
            {extracting && (
              <Notice>
                正在抽取句块… {extracting.done}/{extracting.total}
              </Notice>
            )}
            <p className="text-xs text-ink-soft">
              点击高亮的句块查看、编辑；选中一段文字可以手动添加句块。
            </p>
            <ArticleText
              detail={data}
              containerRef={textRef}
              active={active}
              onPick={(h) => {
                setActive(h.chunkId);
                setSelection(null);
              }}
              onSelect={readSelection}
            />
          </div>
        </div>

        {(selection || selectionError) && (
          <div className="flex items-center justify-between gap-4 border-t border-line bg-panel-muted px-8 py-3 text-sm">
            {selection ? (
              <>
                <span className="min-w-0 truncate">
                  已选中：
                  <span className="font-display text-base font-medium">{selection.surface}</span>
                </span>
                <Button variant="primary" className="shrink-0" onClick={() => setAdding(selection)}>
                  添加为句块
                </Button>
              </>
            ) : (
              <span className="text-warn">{selectionError}</span>
            )}
          </div>
        )}
      </div>

      {activeHighlight && (
        <ChunkPanel
          key={activeHighlight.chunkId}
          highlight={activeHighlight}
          onClose={() => setActive(null)}
          onSaved={() => article.reload()}
        />
      )}

      {adding && (
        <AddChunkModal
          article={data}
          selected={adding}
          onClose={() => setAdding(null)}
          onAdded={(merged) => {
            setAdding(null);
            setSelection(null);
            window.getSelection()?.removeAllRanges();
            setMessage({ tone: "success", text: merged ? "已合并为例句。" : "已添加句块。" });
            article.reload();
          }}
        />
      )}

      {confirmDelete !== null && (
        <Dialog
          title="删除这篇文章？"
          confirmLabel="删除"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            setConfirmDelete(null);
            void deleteArticle(db, data.id)
              .then(() => navigate("/articles"))
              .catch((e: unknown) => setMessage({ tone: "error", text: errorMessage(e) }));
          }}
        >
          {confirmDelete > 0 ? (
            <>
              将同时删除 <strong>{confirmDelete}</strong> 个只属于这篇文章的句块及其学习进度。
            </>
          ) : (
            <>没有只属于这篇文章的句块会被删除。</>
          )}
          与其他文章合并过的句块会保留，只删除来自这篇文章的例句。此操作不可撤销。
        </Dialog>
      )}
    </div>
  );
}

function ArticleText({
  detail,
  containerRef,
  active,
  onPick,
  onSelect,
}: {
  detail: ArticleDetail;
  containerRef: React.RefObject<HTMLDivElement | null>;
  active: string | null;
  onPick: (h: ArticleHighlight) => void;
  onSelect: () => void;
}) {
  const paragraphs = useMemo(() => {
    const spans = detail.highlights.map((h) => ({ ...h, end: h.start + h.length }));
    return splitParagraphs(detail.text).map((p) => ({
      idx: p.idx,
      segments: segmentParagraph(p, spans),
    }));
  }, [detail]);

  return (
    <div
      ref={containerRef}
      className="space-y-4 font-serif text-lg leading-relaxed text-ink"
      onMouseUp={onSelect}
      onKeyUp={onSelect}
    >
      {paragraphs.map((p) => (
        <p key={p.idx}>
          {p.segments.map((s) =>
            s.highlight ? (
              <mark
                key={s.start}
                data-offset={s.start}
                role="button"
                tabIndex={0}
                title={`${s.highlight.lemma}：${s.highlight.meaning}`}
                className={cx(
                  "cursor-pointer rounded px-0.5 text-inherit",
                  s.highlight.chunkId === active ? "bg-accent-soft" : "bg-mark hover:bg-warn-soft",
                )}
                onClick={() => {
                  const sel = window.getSelection();
                  if (sel && !sel.isCollapsed) return;
                  if (s.highlight) onPick(s.highlight);
                }}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && s.highlight) {
                    e.preventDefault();
                    onPick(s.highlight);
                  }
                }}
              >
                {s.text}
              </mark>
            ) : (
              <span key={s.start} data-offset={s.start}>
                {s.text}
              </span>
            ),
          )}
        </p>
      ))}
    </div>
  );
}

function ChunkPanel({
  highlight,
  onClose,
  onSaved,
}: {
  highlight: ArticleHighlight;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (editing === null) return;
    try {
      await updateMeaning(db, highlight.chunkId, editing);
      setEditing(null);
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-4 border-l border-line bg-panel-muted px-5 py-5">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-display text-lg font-semibold break-words">{highlight.lemma}</h2>
        <button
          type="button"
          aria-label="关闭"
          className="shrink-0 text-ink-faint hover:text-ink"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div>
        <StatusBadge status={highlight.status} />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {editing === null ? (
        <div className="space-y-2">
          <p className="text-sm text-ink">{highlight.meaning}</p>
          <Button variant="ghost" className="-ml-3" onClick={() => setEditing(highlight.meaning)}>
            编辑释义
          </Button>
        </div>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <TextInput
            autoFocus
            aria-label="中文释义"
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(null);
            }}
          />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={!editing.trim()}>
              保存
            </Button>
            <Button onClick={() => setEditing(null)}>取消</Button>
          </div>
        </form>
      )}
      <Link to={`/chunks/${highlight.chunkId}`} className="text-sm text-accent hover:underline">
        查看详情 →
      </Link>
    </aside>
  );
}

function AddChunkModal({
  article,
  selected,
  onClose,
  onAdded,
}: {
  article: ArticleDetail;
  selected: Selected;
  onClose: () => void;
  onAdded: (merged: boolean) => void;
}) {
  const [lemma, setLemma] = useState(selected.surface);
  const [meaning, setMeaning] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** 原形与库中已有句块相同：让用户选择合并还是新建 */
  const [existing, setExisting] = useState<{ key: string; chunks: SameLemmaChunk[] } | null>(null);
  const [choice, setChoice] = useState<string>("new");

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const key = lemmaKey(lemma);
      if (!existing || existing.key !== key) {
        const same = await chunksWithLemma(db, lemma);
        if (same.length > 0) {
          setExisting({ key, chunks: same });
          setChoice(same[0]?.id ?? "new");
          return;
        }
      }
      const merge = existing?.key === key && choice !== "new" ? choice : undefined;
      const result = await addManualChunk(db, {
        articleId: article.id,
        sentenceId: selected.sentence.id,
        surface: selected.surface,
        startInSentence: selected.span.start - selected.sentence.start,
        lemma,
        meaning,
        mergeInto: merge,
      });
      onAdded(result.merged);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const merging = existing !== null && existing.key === lemmaKey(lemma) && choice !== "new";

  return (
    <Modal title="添加句块" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="原文形式">
          <p className="rounded-xl bg-ink/5 px-3 py-2 font-display text-sm">{selected.surface}</p>
        </Field>
        <Field
          label="原形"
          hint="动词用原形；物主代词写作 one's，反身代词写作 oneself，指人的宾语写作 someone。"
        >
          <TextInput autoFocus value={lemma} onChange={(e) => setLemma(e.target.value)} />
        </Field>
        {existing && existing.key === lemmaKey(lemma) && (
          <fieldset className="space-y-2 rounded-xl border border-warn/40 bg-warn-soft p-3 text-sm">
            <legend className="px-1 font-medium">库里已有这个句块</legend>
            {existing.chunks.map((c) => (
              <label key={c.id} className="flex items-start gap-2">
                <input
                  type="radio"
                  name="choice"
                  className="mt-1 accent-[var(--accent)]"
                  checked={choice === c.id}
                  onChange={() => setChoice(c.id)}
                />
                <span>
                  合并为例句：{c.meaning}
                  <span className="ml-1 text-xs text-ink-soft">（{c.exampleCount} 个例句）</span>
                </span>
              </label>
            ))}
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="choice"
                className="mt-1 accent-[var(--accent)]"
                checked={choice === "new"}
                onChange={() => setChoice("new")}
              />
              <span>新建义项（意思不同）</span>
            </label>
          </fieldset>
        )}
        {!merging && (
          <Field label="中文释义">
            <TextInput value={meaning} onChange={(e) => setMeaning(e.target.value)} />
          </Field>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>取消</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={saving || !lemma.trim() || (!merging && !meaning.trim())}
          >
            {merging ? "合并为例句" : "添加"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

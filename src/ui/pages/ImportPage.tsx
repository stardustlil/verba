import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { splitParagraphs } from "../../core/text/segment";
import { Button, Notice, Page, TextInput, cx, textAreaStyle } from "../components";
import { useAsync } from "../hooks";
import { type ImportState, useImport } from "../import/ImportContext";
import { draftFromFile, draftFromHtml, draftFromPaste } from "../import/importSource";
import { errorMessage, fetchUrl, getApiKeyMasked, readTextFile } from "../services";

export default function ImportPage() {
  const { state } = useImport();
  if (state.step === "input") return <InputStep />;
  if (state.step === "preview") return <PreviewStep state={state} />;
  if (state.step === "running") return <RunningStep state={state} />;
  return <DoneStep state={state} />;
}

/** 第一步：粘贴文本、粘贴网址或拖入文件（需求 2.1） */
function InputStep() {
  const { openDraft } = useImport();
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") setDragging(true);
        else if (payload.type === "leave") setDragging(false);
        else if (payload.type === "drop") {
          setDragging(false);
          const path = payload.paths[0];
          if (!path) return;
          readTextFile(path)
            .then((file) => openDraft(draftFromFile(file.name, file.content)))
            .catch((e: unknown) => setError(errorMessage(e)));
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [openDraft]);

  const submitText = () => {
    try {
      openDraft(draftFromPaste(text));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const submitUrl = async () => {
    setFetching(true);
    setError(null);
    try {
      const page = await fetchUrl(url);
      openDraft(draftFromHtml(page.html, page.final_url));
    } catch (e) {
      setError(`${errorMessage(e)}。可以改为复制网页上的文字，粘贴到下面的文本框。`);
    } finally {
      setFetching(false);
    }
  };

  return (
    <Page title="导入文章" description="粘贴英文文字、粘贴网址，或把 txt / md 文件拖进窗口。">
      <div className="flex min-h-0 flex-1 flex-col gap-5">
        {error && <Notice tone="error">{error}</Notice>}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim() && !fetching) void submitUrl();
          }}
        >
          <TextInput
            type="url"
            aria-label="网址"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button type="submit" className="shrink-0" disabled={!url.trim() || fetching}>
            {fetching ? "正在提取…" : "提取网页正文"}
          </Button>
        </form>

        <div
          className={cx(
            "relative flex min-h-0 flex-1 flex-col rounded-xl",
            dragging && "ring-2 ring-accent",
          )}
        >
          <textarea
            aria-label="英文文字"
            className={cx(textAreaStyle, "min-h-48 flex-1 resize-none")}
            placeholder="在这里粘贴英文文字…"
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {dragging && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-accent-soft text-sm font-medium text-accent">
              松开以导入文件
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="primary" disabled={!text.trim()} onClick={submitText}>
            下一步：预览
          </Button>
        </div>
      </div>
    </Page>
  );
}

/** 把一段文字按“被合并的断词”切开，便于高亮 */
function highlightJoins(
  paragraph: { text: string; start: number },
  joins: ReadonlyArray<{ offset: number; word: string }>,
) {
  const parts: Array<{ text: string; marked: boolean }> = [];
  let cursor = 0;
  for (const join of joins) {
    const from = join.offset - paragraph.start;
    if (from < cursor || from + join.word.length > paragraph.text.length) continue;
    if (from > cursor) parts.push({ text: paragraph.text.slice(cursor, from), marked: false });
    parts.push({ text: paragraph.text.slice(from, from + join.word.length), marked: true });
    cursor = from + join.word.length;
  }
  if (cursor < paragraph.text.length)
    parts.push({ text: paragraph.text.slice(cursor), marked: false });
  return parts;
}

/** 第二步：预览清理后的正文，可修改，并选择要抽取的段落（需求 2.3） */
function PreviewStep({ state }: { state: Extract<ImportState, { step: "preview" }> }) {
  const { setTitle, setText, setSelected, save, reset } = useImport();
  const { draft, selected } = state;
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(draft.text);
  const apiKey = useAsync(getApiKeyMasked, []);
  const hasKey = Boolean(apiKey.data);

  const paragraphs = useMemo(() => splitParagraphs(draft.text), [draft.text]);
  const toggle = (idx: number) => {
    const next = new Set(selected);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelected(next);
  };

  if (editing) {
    return (
      <Page
        title="编辑正文"
        description="段落之间空一行。完成后回到预览。"
        actions={
          <>
            <Button
              onClick={() => {
                setEditText(draft.text);
                setEditing(false);
              }}
            >
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setText(editText);
                setEditing(false);
              }}
            >
              完成编辑
            </Button>
          </>
        }
      >
        <textarea
          aria-label="正文"
          autoFocus
          className={cx(textAreaStyle, "min-h-0 flex-1 resize-none")}
          spellCheck={false}
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
        />
      </Page>
    );
  }

  const canExtract = hasKey && selected.size > 0;
  return (
    <Page title="预览" description="检查清理后的正文，勾选要抽取句块的段落。">
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {state.error && <Notice tone="error">{state.error}</Notice>}

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">标题</span>
          <TextInput value={draft.title} onChange={(e) => setTitle(e.target.value)} />
        </label>

        {draft.joins.length > 0 && (
          <Notice tone="warning">
            自动合并了 {draft.joins.length} 处跨行断开的单词，已在正文中标出，请检查是否正确：
            {draft.joins.map((j) => j.word).join("、")}
          </Notice>
        )}

        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-soft">
            已选 {selected.size} / {paragraphs.length} 段
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              onClick={() => setSelected(new Set(paragraphs.map((p) => p.idx)))}
            >
              全选
            </Button>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              全不选
            </Button>
            <Button
              onClick={() => {
                setEditText(draft.text);
                setEditing(true);
              }}
            >
              编辑正文
            </Button>
          </div>
        </div>

        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto rounded-2xl bg-panel shadow-card ring-1 ring-line">
          {paragraphs.map((paragraph) => {
            const checked = selected.has(paragraph.idx);
            return (
              <li key={paragraph.idx}>
                <label
                  className={cx(
                    "flex cursor-pointer gap-3 px-3.5 py-3 text-sm leading-relaxed",
                    checked ? "text-ink" : "text-ink-faint",
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
                    checked={checked}
                    onChange={() => toggle(paragraph.idx)}
                  />
                  <span>
                    {highlightJoins(paragraph, draft.joins).map((part, i) =>
                      part.marked ? (
                        <mark key={i} className="rounded bg-mark px-0.5 text-ink">
                          {part.text}
                        </mark>
                      ) : (
                        <span key={i}>{part.text}</span>
                      ),
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        {!apiKey.loading && !hasKey && (
          <Notice>
            还没有填写 API key，文章会照常保存，但不会自动抽取句块。可以先到
            <Link to="/settings" className="mx-1 font-medium text-accent underline">
              设置
            </Link>
            填写。
          </Notice>
        )}
        {hasKey && (
          <p className="text-xs text-ink-soft">
            抽取时，选中的段落会发送到你在设置中配置的 AI 服务。
          </p>
        )}

        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={reset} disabled={state.saving}>
            放弃
          </Button>
          <div className="flex gap-2">
            {hasKey && (
              <Button onClick={() => void save(false)} disabled={state.saving}>
                只保存文章
              </Button>
            )}
            <Button
              variant="primary"
              disabled={state.saving || apiKey.loading || (hasKey && !canExtract)}
              onClick={() => void save(hasKey)}
            >
              {hasKey ? "保存并抽取句块" : "保存文章"}
            </Button>
          </div>
        </div>
      </div>
    </Page>
  );
}

function RunningStep({ state }: { state: Extract<ImportState, { step: "running" }> }) {
  const percent = state.total === 0 ? 0 : Math.round((state.done / state.total) * 100);
  return (
    <Page title="正在抽取句块" description={state.title}>
      <div className="space-y-3">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={state.total}
          aria-valuenow={state.done}
          className="h-2 overflow-hidden rounded-full bg-ink/5"
        >
          <div className="h-full bg-accent transition-all" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-sm text-ink-soft">
          已完成 {state.done} / {state.total} 部分。可以先去别的页面，抽取会在后台继续。
        </p>
      </div>
    </Page>
  );
}

function DoneStep({ state }: { state: Extract<ImportState, { step: "done" }> }) {
  const { reset, retryFailed } = useImport();
  const navigate = useNavigate();
  const { summary } = state;
  // 全部失败且什么都没入库时，只显示失败提示
  const allFailed =
    summary !== null &&
    summary.failedBatches >= summary.batches &&
    summary.added + summary.merged === 0;
  return (
    <Page title="导入完成" description={state.title}>
      <div className="space-y-4">
        {summary === null ? (
          <Notice tone="success">文章已保存，没有抽取句块。</Notice>
        ) : allFailed ? null : (
          <Notice tone="success">
            已添加 {summary.added} 个新句块，{summary.merged} 个合并为例句。
          </Notice>
        )}
        {summary !== null && summary.failedBatches > 0 && (
          <Notice tone="warning">
            <p>
              {allFailed
                ? "抽取失败，文章已保存。"
                : `有 ${summary.failedBatches} 部分抽取失败，其余部分已正常入库。`}
              {summary.firstError && (
                <span className="mt-1 block opacity-80">原因：{summary.firstError}</span>
              )}
            </p>
            <Button className="mt-3" onClick={() => void retryFailed()}>
              重试失败部分
            </Button>
          </Notice>
        )}
        <div className="flex gap-2">
          <Button variant="primary" onClick={reset}>
            再导入一篇
          </Button>
          <Button onClick={() => navigate(`/articles/${state.articleId}`)}>查看文章</Button>
          <Button onClick={() => navigate("/")}>回到首页</Button>
        </div>
      </div>
    </Page>
  );
}

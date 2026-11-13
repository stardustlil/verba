import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { deleteAltAnswer, softDeleteChunk, updateMeaning } from "../../repo/chunks";
import { chunkDetail } from "../../repo/library";
import { Button, Dialog, Notice, Page, TextInput } from "../components";
import { StatusBadge, formatDate, formatDateTime, formatDue } from "../format";
import { useAsync } from "../hooks";
import { Sentence } from "../practice/parts";
import { db, errorMessage } from "../services";

const ORIGIN_LABEL = { ai: "AI 抽取", manual: "手动添加", book: "来自词书" } as const;
const RATING_LABEL = { good: "好", hard: "一般", again: "忘了" } as const;
const RATING_STYLE = {
  good: "text-good",
  hard: "text-warn",
  again: "text-bad",
} as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-ink-soft">{title}</h2>
      {children}
    </section>
  );
}

/** 句块详情（需求 8.2） */
export default function ChunkDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const chunk = useAsync(() => chunkDetail(db, id), [id]);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const c = chunk.data;
  if (chunk.loading && !c) return null;
  if (!c) {
    return (
      <Page title="句块">
        <div className="space-y-4">
          <Notice tone="error">{chunk.error ?? "句块不存在或已删除。"}</Notice>
          <Link to="/chunks" className="text-sm text-accent hover:underline">
            返回句块列表
          </Link>
        </div>
      </Page>
    );
  }

  return (
    <Page
      title={c.lemma}
      description={
        <span className="flex items-center gap-3">
          <StatusBadge status={c.status} />
          <span>{ORIGIN_LABEL[c.origin]}</span>
          <span>{formatDate(c.createdAt)} 添加</span>
          {c.status !== "new" && <span>下次复习：{formatDue(c.due, c.status)}</span>}
        </span>
      }
      actions={
        <>
          <Button variant="ghost" onClick={() => navigate(-1)}>
            返回
          </Button>
          <Button variant="ghost" className="text-bad" onClick={() => setConfirmDelete(true)}>
            删除句块
          </Button>
        </>
      }
    >
      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto pr-1 pb-8">
        {error && <Notice tone="error">{error}</Notice>}

        <Section title="中文释义">
          {editing === null ? (
            <div className="flex items-center gap-3">
              <p className="text-lg">{c.meaning}</p>
              <Button variant="ghost" onClick={() => setEditing(c.meaning)}>
                编辑
              </Button>
            </div>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  await updateMeaning(db, c.id, editing);
                  setEditing(null);
                  chunk.reload();
                });
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
              <Button type="submit" variant="primary" disabled={!editing.trim()}>
                保存
              </Button>
              <Button onClick={() => setEditing(null)}>取消</Button>
            </form>
          )}
        </Section>

        <Section title={`例句（${c.examples.length}）`}>
          <ul className="space-y-3">
            {c.examples.map((e) => (
              <li key={e.id} className="rounded-xl bg-panel px-5 py-4 ring-1 ring-line">
                <Sentence
                  text={e.sentence}
                  start={e.start}
                  length={e.surface.length}
                  className="text-base"
                />
                {e.translation && <p className="mt-1 text-sm text-ink-soft">{e.translation}</p>}
                {e.articleId ? (
                  <Link
                    to={`/articles/${e.articleId}`}
                    className="mt-1 inline-block text-xs text-ink-soft hover:text-accent"
                  >
                    出自《{e.sourceTitle}》
                  </Link>
                ) : (
                  <span className="mt-1 inline-block text-xs text-ink-soft">
                    出自《{e.sourceTitle}》
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="备选答案">
          {c.altAnswers.length === 0 ? (
            <p className="text-sm text-ink-soft">
              没有。纯中文默写时用“我写的也对”改判的写法会存在这里。
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {c.altAnswers.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-1 rounded-lg bg-panel py-1 pr-1 pl-3 font-display ring-1 ring-line text-sm"
                >
                  {a.text}
                  <button
                    type="button"
                    aria-label={`删除备选答案 ${a.text}`}
                    className="rounded px-1.5 text-ink-faint hover:bg-ink/5 hover:text-bad"
                    onClick={() =>
                      void act(async () => {
                        await deleteAltAnswer(db, a.id);
                        chunk.reload();
                      })
                    }
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={`复习记录（${c.reviews.length}）`}>
          {c.reviews.length === 0 ? (
            <p className="text-sm text-ink-soft">还没有答过题。</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-soft">
                <tr>
                  <th className="py-1 font-normal">时间</th>
                  <th className="py-1 font-normal">题型</th>
                  <th className="py-1 font-normal">结果</th>
                  <th className="py-1 font-normal">输入</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {c.reviews.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">
                      {formatDateTime(r.answeredAt)}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {r.mode === "cloze" ? "语境填空" : "纯中文默写"}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      <span className={RATING_STYLE[r.rating]}>{RATING_LABEL[r.rating]}</span>
                      <span className="ml-1 text-xs text-ink-faint">
                        {[
                          r.viewedAnswer && "看了答案",
                          r.overridden && "改判",
                          !r.counted && "不计入复习安排",
                        ]
                          .filter(Boolean)
                          .join("·")}
                      </span>
                    </td>
                    <td className="max-w-60 truncate py-1.5 font-display" title={r.input}>
                      {r.input}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>

      {confirmDelete && (
        <Dialog
          title="删除这个句块？"
          confirmLabel="删除"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void act(async () => {
              await softDeleteChunk(db, c.id);
              navigate(-1);
            });
          }}
        >
          “{c.lemma}
          ”及其学习进度将被删除，原形进入忽略名单，以后从其他文章抽取到相同原形时不再入库。
        </Dialog>
      )}
    </Page>
  );
}

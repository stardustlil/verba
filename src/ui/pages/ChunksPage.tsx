import { Link, useSearchParams } from "react-router-dom";
import type { ChunkStatus } from "../../core/srs/stage";
import { listBooks } from "../../repo/books";
import { type ChunkSort, listArticles, listChunks } from "../../repo/library";
import { Notice, Page, TextInput, selectStyle } from "../components";
import { StatusBadge, formatDue } from "../format";
import { useAsync } from "../hooks";
import { db } from "../services";

const STATUSES: Array<{ value: ChunkStatus | "all"; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "new", label: "新" },
  { value: "learning", label: "学习中" },
  { value: "mastered", label: "已掌握" },
];

const SORTS: Array<{ value: ChunkSort; label: string }> = [
  { value: "added", label: "按添加时间" },
  { value: "due", label: "按下次复习时间" },
  { value: "errors", label: "按出错次数" },
];

/** 句块列表（需求 8.1）。筛选条件放在地址里，从详情返回时保留。 */
export default function ChunksPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get("q") ?? "";
  const status = (params.get("status") ?? "all") as ChunkStatus | "all";
  const articleId = params.get("article") ?? "";
  const bookId = params.get("book") ?? "";
  const sort = (params.get("sort") ?? "added") as ChunkSort;

  const update = (key: string, value: string, fallback: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== fallback) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const chunks = useAsync(
    () =>
      listChunks(db, {
        search,
        status,
        articleId: articleId || null,
        bookId: bookId || null,
        sort,
      }),
    [search, status, articleId, bookId, sort],
  );
  const articles = useAsync(() => listArticles(db), []);
  const books = useAsync(() => listBooks(db), []);
  const items = chunks.data ?? [];

  return (
    <Page title="句块" description={chunks.data ? `共 ${items.length} 个` : undefined}>
      <div className="mb-4 flex flex-wrap gap-2">
        <TextInput
          type="search"
          aria-label="搜索"
          placeholder="搜索英文或中文"
          className="min-w-48 flex-1"
          value={search}
          onChange={(e) => update("q", e.target.value, "")}
        />
        <select
          aria-label="状态"
          className={selectStyle}
          value={status}
          onChange={(e) => update("status", e.target.value, "all")}
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          aria-label="词书"
          className={`${selectStyle} max-w-44`}
          value={bookId}
          onChange={(e) => update("book", e.target.value, "")}
        >
          <option value="">全部词书</option>
          {(books.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>
        <select
          aria-label="来源文章"
          className={`${selectStyle} max-w-48`}
          value={articleId}
          onChange={(e) => update("article", e.target.value, "")}
        >
          <option value="">全部文章</option>
          {(articles.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
        <select
          aria-label="排序"
          className={selectStyle}
          value={sort}
          onChange={(e) => update("sort", e.target.value, "added")}
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {chunks.error && <Notice tone="error">{chunks.error}</Notice>}
        {chunks.data && items.length === 0 && (
          <p className="text-sm text-ink-soft">
            {search || status !== "all" || articleId || bookId
              ? "没有符合条件的句块。"
              : "句块库还是空的。"}
          </p>
        )}
        {items.length > 0 && (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-panel shadow-card ring-1 ring-line">
            {items.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/chunks/${c.id}`}
                  className="flex items-center gap-4 px-4 py-2.5 hover:bg-panel-muted focus-visible:bg-panel-muted focus-visible:outline-none"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display text-[15px] text-ink">{c.lemma}</div>
                    <div className="truncate text-sm text-ink-soft">{c.meaning}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-ink-soft tabular-nums">
                    {c.errors > 0 && <span title="出错次数">错 {c.errors}</span>}
                    {c.status !== "new" && (
                      <span title="下次复习">{formatDue(c.due, c.status)}</span>
                    )}
                    <StatusBadge status={c.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Page>
  );
}

import { ArrowLeft, Check, Play, Search } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { MY_BOOK, currentBookId, listBooks, setCurrentBook } from "../../repo/books";
import { listChunks } from "../../repo/library";
import { BookCover } from "../bookCover";
import { Button, Card, Notice, ProgressBar, TextInput } from "../components";
import { StatusBadge } from "../format";
import { useAsync } from "../hooks";
import { db, errorMessage } from "../services";

/** 一本词书的全部条目 */
export default function BookDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const info = useAsync(async () => {
    const [books, current] = await Promise.all([listBooks(db), currentBookId(db)]);
    return { book: books.find((b) => b.id === id) ?? null, current };
  }, [id]);
  const chunks = useAsync(
    () => listChunks(db, { bookId: id, search, sort: id === MY_BOOK ? "added" : "book" }),
    [id, search],
  );

  const book = info.data?.book;
  const current = info.data?.current === id;

  const choose = async () => {
    try {
      await setCurrentBook(db, id);
      info.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (info.data && !book) {
    return (
      <div className="p-10">
        <Notice tone="error">词书不存在。</Notice>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-10 pt-7 pb-6">
      <Link
        to="/books"
        className="mb-4 flex items-center gap-1 text-xs text-ink-soft hover:text-accent"
      >
        <ArrowLeft size={13} />
        词书
      </Link>
      {(error ?? info.error ?? chunks.error) && (
        <div className="mb-4">
          <Notice tone="error">{error ?? info.error ?? chunks.error}</Notice>
        </div>
      )}
      {book && (
        <Card className="mb-6 flex gap-6 p-6">
          <BookCover id={book.id} color={book.color} title={book.title} size="lg" />
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="text-2xl font-semibold tracking-tight">{book.title}</h1>
            <p className="mt-1.5 max-w-xl text-sm text-ink-soft">{book.description}</p>
            <div className="mt-auto flex items-end gap-6 pt-4">
              <div className="w-64">
                <div className="mb-1.5 flex justify-between text-xs text-ink-soft">
                  <span>
                    已学 {book.learned} / {book.total}
                  </span>
                </div>
                <ProgressBar value={book.learned} max={book.total} />
              </div>
              <div className="ml-auto flex gap-2">
                {current ? (
                  <>
                    <span className="flex items-center gap-1 text-sm text-accent">
                      <Check size={15} />
                      正在学
                    </span>
                    <Button variant="primary" onClick={() => navigate("/practice")}>
                      <Play size={15} />
                      开始学习
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="primary"
                    disabled={book.fresh === 0}
                    onClick={() => void choose()}
                  >
                    学这本
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="relative mb-3">
        <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint" />
        <TextInput
          type="search"
          aria-label="搜索"
          placeholder="在这本书里搜索英文或中文"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {chunks.data && chunks.data.length === 0 && (
          <p className="py-6 text-center text-sm text-ink-soft">
            {search ? "没有符合条件的句块。" : "这本书里还没有句块。"}
          </p>
        )}
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {chunks.data?.map((c, i) => (
            <li key={c.id}>
              <Link
                to={`/chunks/${c.id}`}
                className="flex items-center gap-3 rounded-xl bg-panel px-4 py-3 ring-1 ring-line transition-colors hover:ring-accent/40"
              >
                {!search && id !== MY_BOOK && (
                  <span className="w-7 shrink-0 text-right text-xs text-ink-faint tabular-nums">
                    {i + 1}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-[15px] text-ink">{c.lemma}</div>
                  <div className="truncate text-xs text-ink-soft">{c.meaning}</div>
                </div>
                <StatusBadge status={c.status} />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

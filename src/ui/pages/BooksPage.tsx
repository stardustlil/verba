import { Check } from "lucide-react";
import { Link } from "react-router-dom";
import { currentBookId, listBooks, setCurrentBook } from "../../repo/books";
import { BookCover } from "../bookCover";
import { Button, Card, Notice, Page, ProgressBar } from "../components";
import { useAsync } from "../hooks";
import { db, errorMessage } from "../services";
import { useState } from "react";

/** 词书：内置的三本书和“我的短语”。新短语从当前词书中按顺序取。 */
export default function BooksPage() {
  const data = useAsync(async () => {
    const [books, current] = await Promise.all([listBooks(db), currentBookId(db)]);
    return { books, current };
  }, []);
  const [error, setError] = useState<string | null>(null);

  const choose = async (id: string) => {
    try {
      await setCurrentBook(db, id);
      data.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Page title="词书">
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {(error ?? data.error) && <Notice tone="error">{error ?? data.error}</Notice>}
        <div className="stagger grid grid-cols-1 gap-4 lg:grid-cols-2">
          {data.data?.books.map((book) => {
            const current = book.id === data.data?.current;
            return (
              <Card
                key={book.id}
                className="flex gap-5 p-5 transition-[box-shadow,translate] duration-300 ease-out hover:-translate-y-0.5 hover:shadow-float"
              >
                <Link to={`/books/${book.id}`} className="shrink-0">
                  <BookCover id={book.id} color={book.color} title={book.title} />
                </Link>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      to={`/books/${book.id}`}
                      className="text-base font-semibold text-ink hover:text-accent"
                    >
                      {book.title}
                    </Link>
                    {current && (
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-ink">
                        <Check size={12} />
                        正在学
                      </span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{book.description}</p>
                  <div className="mt-auto pt-4">
                    <div className="mb-1.5 flex justify-between text-xs text-ink-soft">
                      <span>
                        已学 {book.learned} / {book.total}
                      </span>
                      {book.total > 0 && (
                        <span className="tabular-nums">
                          {Math.round((book.learned / book.total) * 100)}%
                        </span>
                      )}
                    </div>
                    <ProgressBar value={book.learned} max={book.total} />
                  </div>
                </div>
                <div className="flex shrink-0 flex-col justify-end">
                  {!current && (
                    <Button
                      size="sm"
                      variant="soft"
                      disabled={book.fresh === 0}
                      onClick={() => void choose(book.id)}
                    >
                      学这本
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </Page>
  );
}

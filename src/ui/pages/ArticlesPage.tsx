import { FileText } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { listArticles } from "../../repo/library";
import { Button, Notice, Page } from "../components";
import { formatDate } from "../format";
import { useAsync } from "../hooks";
import { db } from "../services";

function sourceLabel(item: { sourceType: string; sourceRef: string | null }): string {
  if (item.sourceType === "url" && item.sourceRef) {
    try {
      return new URL(item.sourceRef).hostname;
    } catch {
      return item.sourceRef;
    }
  }
  if (item.sourceType === "file") return item.sourceRef ?? "文件";
  return "粘贴";
}

/** 文章列表（需求 7.1） */
export default function ArticlesPage() {
  const articles = useAsync(() => listArticles(db), []);
  const navigate = useNavigate();
  const items = articles.data ?? [];

  return (
    <Page
      title="文章"
      description={articles.data ? `共 ${items.length} 篇` : undefined}
      actions={
        <Button variant="primary" onClick={() => navigate("/import")}>
          导入文章
        </Button>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {articles.error && <Notice tone="error">{articles.error}</Notice>}
        {articles.data && items.length === 0 && (
          <div className="flex flex-col items-center rounded-2xl bg-panel px-6 py-14 text-center shadow-card ring-1 ring-line">
            <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <FileText size={22} />
            </div>
            <p className="font-medium">还没有导入文章</p>
            <Button variant="primary" className="mt-5" onClick={() => navigate("/import")}>
              导入文章
            </Button>
          </div>
        )}
        {items.length > 0 && (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-panel shadow-card ring-1 ring-line">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  to={`/articles/${item.id}`}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-panel-muted focus-visible:bg-panel-muted focus-visible:outline-none"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-ink">{item.title}</div>
                    <div className="mt-0.5 flex gap-3 text-xs text-ink-soft">
                      <span className="truncate" title={item.sourceRef ?? undefined}>
                        {sourceLabel(item)}
                      </span>
                      <span className="shrink-0">{formatDate(item.createdAt)}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-sm tabular-nums">
                    <div className="text-ink">{item.chunkCount} 个短语</div>
                    <div className="text-xs text-ink-soft">
                      已学 {item.learnedCount}/{item.chunkCount}
                    </div>
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

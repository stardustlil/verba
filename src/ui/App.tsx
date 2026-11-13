import {
  BookOpen,
  CircleHelp,
  FileText,
  GraduationCap,
  Layers,
  type LucideIcon,
  Monitor,
  Moon,
  Settings as SettingsIcon,
  Sun,
} from "lucide-react";
import { useEffect, useState } from "react";
import { HashRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { BUILTIN_BOOKS } from "../data/books";
import { seedBuiltinBooks } from "../repo/books";
import { purgeDeletedChunks } from "../repo/chunks";
import { type Theme, getSettings, saveSettings } from "../repo/settings";
import ArticleDetailPage from "./articles/ArticleDetailPage";
import { cx } from "./components";
import { ImportProvider, useImport } from "./import/ImportContext";
import ArticlesPage from "./pages/ArticlesPage";
import BookDetailPage from "./pages/BookDetailPage";
import BooksPage from "./pages/BooksPage";
import ChunkDetailPage from "./pages/ChunkDetailPage";
import ChunksPage from "./pages/ChunksPage";
import GuidePage from "./pages/GuidePage";
import HomePage from "./pages/HomePage";
import ImportPage from "./pages/ImportPage";
import SettingsPage from "./pages/SettingsPage";
import PracticePage from "./practice/PracticePage";
import { db } from "./services";
import { applyTheme, currentTheme, onThemeChange } from "./theme";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** 这些路径也算在这一项下 */
  also?: string[];
}

const NAV: NavItem[] = [
  { to: "/", label: "学习", icon: GraduationCap },
  { to: "/books", label: "词书", icon: BookOpen },
  { to: "/articles", label: "文章", icon: FileText, also: ["/import"] },
  { to: "/chunks", label: "短语", icon: Layers },
];

const RAIL_ITEM =
  "group relative flex w-14 flex-col items-center gap-1 rounded-xl pt-2 pb-1.5 text-[11px] transition-colors duration-200 " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent outline-none";

function NavButton({ item, badge }: { item: NavItem; badge?: string }) {
  const { pathname } = useLocation();
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      title={badge ? `${item.label}（正在抽取 ${badge}）` : item.label}
      className={({ isActive }) => {
        const active = isActive || (item.also ?? []).some((p) => pathname.startsWith(p));
        return cx(
          RAIL_ITEM,
          active
            ? "bg-accent-soft font-medium text-accent-ink"
            : "text-ink-soft hover:bg-ink/5 hover:text-ink",
        );
      }}
    >
      <Icon
        size={20}
        strokeWidth={1.9}
        className="shrink-0 transition-transform duration-300 ease-spring group-hover:scale-110 group-active:scale-90"
      />
      <span>{item.label}</span>
      {badge && (
        <span className="absolute top-1 right-1 rounded-full bg-accent px-1 text-[9px] leading-[14px] font-medium text-white tabular-nums dark:text-[#16121f]">
          {badge}
        </span>
      )}
    </NavLink>
  );
}

const THEME_ORDER: Theme[] = ["system", "light", "dark"];
const THEME_LABEL: Record<Theme, string> = { system: "跟随系统", light: "亮色", dark: "暗色" };
const THEME_ICON: Record<Theme, LucideIcon> = { system: Monitor, light: Sun, dark: Moon };

/** 侧栏底部的主题切换：跟随系统 → 亮 → 暗 */
function ThemeButton() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  useEffect(() => onThemeChange(setTheme), []);
  const Icon = THEME_ICON[theme];
  const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]!;
  return (
    <button
      type="button"
      title={`主题：${THEME_LABEL[theme]}（点击切换为${THEME_LABEL[next]}）`}
      aria-label="切换主题"
      className={cx(RAIL_ITEM, "text-ink-soft hover:bg-ink/5 hover:text-ink")}
      onClick={() => {
        applyTheme(next);
        void saveSettings(db, { theme: next }).catch(() => undefined);
      }}
    >
      <Icon
        key={theme}
        size={18}
        strokeWidth={1.9}
        className="animate-pop transition-transform duration-300 ease-spring group-hover:scale-110"
      />
      <span>{THEME_LABEL[theme].slice(0, 2)}</span>
    </button>
  );
}

function Sidebar() {
  const { state } = useImport();
  const badge = state.step === "running" ? `${state.done}/${state.total}` : undefined;
  return (
    <nav aria-label="主导航" className="flex w-[76px] shrink-0 flex-col items-center pt-5 pb-3">
      <div className="flex flex-col items-center gap-1">
        {NAV.map((item) => (
          <NavButton
            key={item.to}
            item={item}
            badge={item.to === "/articles" ? badge : undefined}
          />
        ))}
      </div>
      <div className="mt-auto flex flex-col items-center gap-1">
        <NavButton item={{ to: "/guide", label: "说明", icon: CircleHelp }} />
        <ThemeButton />
        <NavButton item={{ to: "/settings", label: "设置", icon: SettingsIcon }} />
      </div>
    </nav>
  );
}

function Shell() {
  const { pathname } = useLocation();
  // 练习页全屏，不显示侧栏
  const focus = pathname.startsWith("/practice");
  return (
    <div className="flex h-full bg-canvas text-ink">
      {!focus && <Sidebar />}
      <main
        className={cx(
          "min-w-0 flex-1 overflow-hidden",
          !focus && "my-2 mr-2 rounded-2xl bg-panel-muted/60 ring-1 ring-line",
        )}
      >
        <div key={pathname} className={cx("h-full", !focus && "animate-page")}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/practice" element={<PracticePage />} />
            <Route path="/books" element={<BooksPage />} />
            <Route path="/books/:id" element={<BookDetailPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/articles" element={<ArticlesPage />} />
            <Route path="/articles/:id" element={<ArticleDetailPage />} />
            <Route path="/chunks" element={<ChunksPage />} />
            <Route path="/chunks/:id" element={<ChunkDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/guide" element={<GuidePage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    getSettings(db)
      .then((settings) => applyTheme(settings.theme))
      .catch(() => applyTheme("system"));
    // 上次运行时删除、未撤销的短语，启动时彻底清除；然后写入内置词书
    purgeDeletedChunks(db)
      .then(() => seedBuiltinBooks(db, BUILTIN_BOOKS))
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);
  if (!ready) return null;

  return (
    <HashRouter>
      <ImportProvider>
        <Shell />
      </ImportProvider>
    </HashRouter>
  );
}

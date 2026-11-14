/**
 * 使用说明。参考常见的文档页做法：左侧目录（随滚动高亮）+ 搜索，
 * 正文先给快速上手，再用图示讲流程和规则，最后是常见问题。
 */
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  CircleHelp,
  FileText,
  Keyboard,
  Lightbulb,
  type LucideIcon,
  Play,
  Repeat,
  Rocket,
  Search,
  Trophy,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { cx } from "../components";
import { HEAT_LEVEL_STYLE } from "../Heatmap";
import { modLabel } from "../keys";
import { Kbd } from "../practice/parts";

/* ---------------- 小组件 ---------------- */

function Callout({ tone = "tip", children }: { tone?: "tip" | "note"; children: ReactNode }) {
  const Icon = tone === "tip" ? Lightbulb : CircleHelp;
  return (
    <div
      className={cx(
        "flex gap-3 rounded-xl px-4 py-3 text-sm leading-relaxed ring-1",
        tone === "tip"
          ? "bg-accent-soft/60 text-ink ring-accent/15"
          : "bg-panel-muted text-ink-soft ring-line",
      )}
    >
      <Icon size={16} className={cx("mt-0.5 shrink-0", tone === "tip" ? "text-accent" : "")} />
      <div>{children}</div>
    </div>
  );
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-7 mb-3 text-sm font-semibold text-ink">{children}</h3>;
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-ink-soft">{children}</p>;
}

/** 快速上手的一步 */
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="relative rounded-2xl bg-panel p-5 shadow-card ring-1 ring-line">
      <span className="mb-3 flex size-7 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white dark:text-[#16121f]">
        {n}
      </span>
      <div className="font-medium text-ink">{title}</div>
      <div className="mt-1 text-sm leading-relaxed text-ink-soft">{children}</div>
    </li>
  );
}

/** 横向流程图：一格一步，中间用箭头连接 */
function Flow({
  steps,
}: {
  steps: Array<{ title: string; text: ReactNode; tone?: "accent" | "good" | "plain" }>;
}) {
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      {steps.map((s, i) => (
        <div key={s.title} className="flex min-w-36 flex-1 items-center gap-2">
          <div
            className={cx(
              "h-full flex-1 rounded-xl px-3.5 py-3 ring-1",
              s.tone === "good"
                ? "bg-good-soft ring-good/25"
                : s.tone === "accent"
                  ? "bg-accent-soft/70 ring-accent/20"
                  : "bg-panel ring-line",
            )}
          >
            <div
              className={cx(
                "text-sm font-medium",
                s.tone === "good"
                  ? "text-good"
                  : s.tone === "accent"
                    ? "text-accent-ink"
                    : "text-ink",
              )}
            >
              {s.title}
            </div>
            <div className="mt-1 text-xs leading-relaxed text-ink-soft">{s.text}</div>
          </div>
          {i < steps.length - 1 && <ArrowRight size={15} className="shrink-0 text-ink-faint" />}
        </div>
      ))}
    </div>
  );
}

/** 两列表格：左边情形，右边说明 */
function Table({ head, rows }: { head: [string, string]; rows: Array<[ReactNode, ReactNode]> }) {
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-line">
      <table className="w-full text-left text-sm">
        <thead className="bg-panel-muted text-xs text-ink-soft">
          <tr>
            <th className="w-40 px-4 py-2.5 font-medium">{head[0]}</th>
            <th className="px-4 py-2.5 font-medium">{head[1]}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line bg-panel">
          {rows.map(([a, b], i) => (
            <tr key={i} className="align-top">
              <td className="px-4 py-3 font-medium text-ink">{a}</td>
              <td className="px-4 py-3 leading-relaxed text-ink-soft">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ShortcutGroup({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="rounded-xl bg-panel p-4 ring-1 ring-line">
      <div className="mb-2 text-xs font-medium text-ink-faint">{title}</div>
      <ul className="space-y-1">
        {rows.map(([key, text]) => (
          <li key={key} className="flex items-center justify-between gap-3 py-1 text-sm">
            <span className="text-ink-soft">{text}</span>
            <Kbd>{key}</Kbd>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group rounded-xl bg-panel ring-1 ring-line open:shadow-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-ink select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={15}
          className="shrink-0 text-ink-faint transition-transform duration-300 ease-spring group-open:rotate-90"
        />
        {q}
      </summary>
      <div className="animate-rise px-4 pb-4 pl-10 text-sm leading-relaxed text-ink-soft">
        {children}
      </div>
    </details>
  );
}

const LINK = "text-accent hover:underline";

/* ---------------- 正文 ---------------- */

interface Section {
  id: string;
  title: string;
  icon: LucideIcon;
  body: ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: "start",
    title: "快速上手",
    icon: Rocket,
    body: (
      <>
        <P>
          Verba 用打字的方式背英文短语：字母直接打在题目上，程序按间隔重复安排复习。三步就能开始：
        </P>
        <ol className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Step n={1} title="选一本词书">
            在
            <Link to="/books" className={cx(LINK, "mx-1")}>
              词书
            </Link>
            页挑一本，默认从《高频动词短语》开始。
          </Step>
          <Step n={2} title="开始学习">
            在首页按 <Kbd>空格</Kbd>，跟着提示打字。
          </Step>
          <Step n={3} title="每天回来">
            到期的短语会自动出现在每日任务里，坚持复习就能记住。
          </Step>
        </ol>
        <div className="mt-4">
          <Callout>
            每天学几个新短语可以在
            <Link to="/settings" className={cx(LINK, "mx-1")}>
              设置
            </Link>
            里调整，默认 20 个。还想多练时，点首页的“额外练习”再学 30 个，不占每天的额度。
          </Callout>
        </div>
      </>
    ),
  },
  {
    id: "round",
    title: "一轮练习",
    icon: Play,
    body: (
      <>
        <P>每日任务 = 到期的复习 + 当前词书里的新短语。一轮按下面的顺序进行：</P>
        <div className="mt-4">
          <Flow
            steps={[
              { title: "复习", text: "到期的短语，以填空或默写出题" },
              { title: "跟写", text: "新短语照着打一遍，打错的字母会卡住", tone: "accent" },
              { title: "语境填空", text: "在例句的空白处写出短语" },
              { title: "纯中文默写", text: "只看中文释义，写出原形" },
            ]}
          />
        </div>
        <H3>作答时</H3>
        <Table
          head={["情形", "怎么做"]}
          rows={[
            [
              "写对了",
              <>
                写对的那一刻自动判对，不用提交；按 <Kbd>空格</Kbd> 进入下一题
              </>,
            ],
            [
              "写完但没判对",
              <>
                按 <Kbd>Tab</Kbd> 提交。答错后要照着正确答案打一遍，这个短语本轮稍后还会重出
              </>,
            ],
            [
              "不会",
              <>
                还没写时按 <Kbd>Tab</Kbd> 看答案，同样照着打一遍、稍后重出
              </>,
            ],
            [
              "其实我写的也对",
              <>
                答错后按 <Kbd>{modLabel("Enter")}</Kbd>{" "}
                改判。默写时这种写法会存为备选答案，以后直接算对
              </>,
            ],
            [
              "这个早就会了",
              <>
                按 <Kbd>{modLabel("K")}</Kbd> 标记熟练：本轮跳过，60 天后再复习
              </>,
            ],
          ]}
        />
        <H3>判分规则</H3>
        <P>
          宽容但严格：大小写、标点不计较；英美拼写（colour / color）、缩写（don&apos;t / do
          not）视为相同；原形里的 someone / one&apos;s / oneself，写成对应的人称代词都算对，someone
          也可以写作 somebody / sb。
        </P>
      </>
    ),
  },
  {
    id: "keys",
    title: "快捷键",
    icon: Keyboard,
    body: (
      <>
        <P>练习全程只用键盘就够了。Mac 用 Cmd，Windows / Linux 用 Ctrl。</P>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <ShortcutGroup
            title="作答"
            rows={[
              ["空格", "下一题；在首页开始学习"],
              ["Tab", "提交；还没写时看答案"],
              [modLabel("Enter"), "我写的也对"],
              ["Esc", "结束本轮"],
            ]}
          />
          <ShortcutGroup
            title="整理短语"
            rows={[
              [modLabel("K"), "标记熟练"],
              [modLabel("E"), "修改中文释义"],
              [modLabel("D"), "删除短语"],
              [modLabel("Z"), "撤销删除或熟练"],
            ]}
          />
          <ShortcutGroup title="其他" rows={[[modLabel("P"), "朗读"]]} />
        </div>
      </>
    ),
  },
  {
    id: "review",
    title: "复习与掌握",
    icon: Repeat,
    body: (
      <>
        <P>复习时间由 FSRS 间隔重复算法自动安排，你只管作答。每个短语会经历这几个阶段：</P>
        <div className="mt-4">
          <Flow
            steps={[
              { title: "新短语", text: "跟写一遍" },
              { title: "语境填空", text: "隔天连续写对两次即升级", tone: "accent" },
              { title: "纯中文默写", text: "写错退回语境填空", tone: "accent" },
              { title: "已掌握", text: "复习间隔达到 21 天", tone: "good" },
            ]}
          />
        </div>
        <H3>自动评级</H3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            ["记得", "写对", "bg-good"],
            ["一般", "写对，但用时超过“写得慢”的秒数（默认 30 秒，可在设置里改）", "bg-warn"],
            ["忘了", "写错，或看了答案", "bg-bad"],
          ].map(([name, text, dot]) => (
            <div key={name} className="rounded-xl bg-panel p-4 ring-1 ring-line">
              <div className="flex items-center gap-2 text-sm font-medium text-ink">
                <span className={cx("size-2 rounded-full", dot)} />
                {name}
              </div>
              <div className="mt-1 text-xs leading-relaxed text-ink-soft">{text}</div>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <Callout tone="note">
            每个短语每天只有第一次作答计入复习安排；本轮的重出只是帮你巩固，不会影响评级。
          </Callout>
        </div>
      </>
    ),
  },
  {
    id: "streak",
    title: "打卡与记录",
    icon: Trophy,
    body: (
      <>
        <Table
          head={["概念", "规则"]}
          rows={[
            ["学习日", "从凌晨 4 点开始计算，熬夜学习仍然算前一天"],
            [
              "打卡一天",
              "完成当天开始时已经到期的全部复习，不要求学完新短语；当天开始时没有到期复习的，练过就算",
            ],
            ["连续学习", "连续打卡的天数；今天还没完成时不算中断"],
            [
              "练习记录",
              <span key="heat" className="inline-flex flex-wrap items-center gap-1.5">
                首页的热图，一格一天，颜色越深练得越多
                {HEAT_LEVEL_STYLE.map((c) => (
                  <span key={c} className={cx("inline-block size-3 rounded-[3px]", c)} />
                ))}
              </span>,
            ],
          ]}
        />
      </>
    ),
  },
  {
    id: "books",
    title: "词书",
    icon: BookOpen,
    body: (
      <>
        <P>
          新短语从<strong className="font-medium text-ink">当前词书</strong>
          里按顺序取，在词书页可以随时换一本；到期的复习不分书，都会出现，换书不会丢进度。
        </P>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            ["高频动词短语", "短语动词与动词搭配"],
            ["介词短语与固定表达", "介词短语、连接表达与固定说法"],
            ["写作常用搭配", "组织论证、衔接上下文的表达"],
          ].map(([name, text]) => (
            <div key={name} className="rounded-xl bg-panel p-4 ring-1 ring-line">
              <div className="text-sm font-medium text-ink">{name}</div>
              <div className="mt-1 text-xs text-ink-soft">{text}</div>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <Callout tone="note">
            内置词书按短语在真实语料中的出现频率排序，越常用越靠前。短语参考开源英汉词典
            ECDICT，例句与翻译大多取自开放的英汉例句库 Tatoeba。
          </Callout>
        </div>
      </>
    ),
  },
  {
    id: "articles",
    title: "从文章里学",
    icon: FileText,
    body: (
      <>
        <P>
          读到好文章，可以把里面的短语收进“我的短语”，和词书一起复习。在
          <Link to="/articles" className={cx(LINK, "mx-1")}>
            文章
          </Link>
          页导入：
        </P>
        <div className="mt-4">
          <Flow
            steps={[
              { title: "导入", text: "粘贴文字、网址，或拖入 txt / md 文件" },
              { title: "勾选段落", text: "预览清理后的正文，选出要学的部分" },
              { title: "AI 抽取", text: "自动挑出值得背的短语，附例句和释义", tone: "accent" },
            ]}
          />
        </div>
        <div className="mt-4">
          <Callout>
            AI 抽取需要先在设置里填写 API key（默认 DeepSeek，也可以换成任何兼容 OpenAI
            格式的服务）。没有 key 也能用：在文章详情里选中一段文字，就能手动添加为短语。
          </Callout>
        </div>
      </>
    ),
  },
  {
    id: "faq",
    title: "常见问题",
    icon: CircleHelp,
    body: (
      <div className="space-y-2">
        <Faq q="“熟练”和“删除”有什么区别？">
          熟练（{modLabel("K")}）：短语留在库里，跳到纯中文默写阶段，60
          天后再复习，算作已掌握。删除（{modLabel("D")}
          ）：短语和学习记录都会去掉，以后导入文章或更新词书时也不会再加回来。两者都可以马上用{" "}
          {modLabel("Z")} 撤销。
        </Faq>
        <Faq q="我明明写对了，为什么判错？">
          判分已经忽略大小写、标点、英美拼写和缩写的差别。如果你的写法确实也对，答错后按{" "}
          {modLabel("Enter")}
          改判；纯中文默写中这种写法会存为备选答案，下次直接算对。
        </Faq>
        <Faq q="额外练习会影响每天的任务吗？">
          不会。额外练习只学新短语，不占用、也不改变每天的新短语数；学过的短语之后照常进入复习。
        </Faq>
        <Faq q="换词书会丢失进度吗？">不会。换书只影响新短语从哪里来；已经学过的短语照常复习。</Faq>
        <Faq q="凌晨 1 点学习算哪一天？">
          算前一天。学习日从凌晨 4 点开始计算，方便熬夜的人保持连续打卡。
        </Faq>
        <Faq q="数据存在哪里？怎么备份？">
          学习数据只保存在本机，API key 单独存放，只有当前用户可读。备份时先退出应用，再到
          <Link to="/settings" className={cx(LINK, "mx-1")}>
            设置
          </Link>
          打开数据文件夹复制。只有导入文章时，你勾选的段落会发送到你配置的 AI
          服务；朗读和音效都不联网。
        </Faq>
      </div>
    ),
  },
];

/* ---------------- 页面 ---------------- */

export default function GuidePage() {
  const scroller = useRef<HTMLDivElement>(null);
  const refs = useRef(new Map<string, HTMLElement>());
  const [active, setActive] = useState(SECTIONS[0]!.id);
  const [query, setQuery] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // 搜索：按正文文字筛选章节
  useEffect(() => {
    const q = query.trim().toLowerCase();
    const next = new Set<string>();
    if (q) {
      for (const s of SECTIONS) {
        const text = `${s.title} ${refs.current.get(s.id)?.textContent ?? ""}`.toLowerCase();
        if (!text.includes(q)) next.add(s.id);
      }
    }
    setHidden(next);
  }, [query]);

  // 滚动时高亮目录：取顶部附近的那一节
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const onScroll = () => {
      const top = root.getBoundingClientRect().top + 80;
      let current = SECTIONS.find((s) => !hidden.has(s.id))?.id ?? SECTIONS[0]!.id;
      for (const s of SECTIONS) {
        const el = refs.current.get(s.id);
        if (!el || hidden.has(s.id)) continue;
        if (el.getBoundingClientRect().top <= top) current = s.id;
      }
      // 滚到底时高亮最后一节
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) {
        const last = [...SECTIONS].reverse().find((s) => !hidden.has(s.id));
        if (last) current = last.id;
      }
      setActive(current);
    };
    onScroll();
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [hidden]);

  const jump = (id: string) => {
    const el = refs.current.get(id);
    const root = scroller.current;
    if (!el || !root) return;
    root.scrollTo({ top: el.offsetTop - 24, behavior: "smooth" });
  };

  const visible = useMemo(() => SECTIONS.filter((s) => !hidden.has(s.id)), [hidden]);

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl gap-10 px-10 pt-9">
      {/* 目录 */}
      <aside className="hidden w-44 shrink-0 md:block">
        <h1 className="text-[26px] font-semibold tracking-tight">使用说明</h1>
        <label className="relative mt-6 block">
          <Search
            size={14}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
          />
          <input
            type="search"
            aria-label="搜索说明"
            placeholder="搜索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 w-full rounded-xl border border-line-strong bg-panel pr-3 pl-8 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-4 focus:ring-accent/15 focus:outline-none"
          />
        </label>
        <nav aria-label="目录" className="mt-4 flex flex-col gap-0.5">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const on = active === s.id;
            return (
              <button
                key={s.id}
                type="button"
                disabled={hidden.has(s.id)}
                onClick={() => jump(s.id)}
                className={cx(
                  "relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors duration-200",
                  on
                    ? "bg-accent-soft font-medium text-accent-ink"
                    : "text-ink-soft hover:bg-ink/5",
                  "disabled:pointer-events-none disabled:opacity-35",
                )}
              >
                <Icon size={15} className="shrink-0" />
                {s.title}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* 正文 */}
      <div ref={scroller} className="relative min-w-0 flex-1 overflow-y-auto pr-1 pb-24">
        <h1 className="mb-6 text-[26px] font-semibold tracking-tight md:hidden">使用说明</h1>
        {visible.length === 0 && (
          <p className="py-10 text-center text-sm text-ink-soft">
            没有找到“{query.trim()}”相关的说明。
          </p>
        )}
        <div className="stagger space-y-12">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <section
                key={s.id}
                id={`guide-${s.id}`}
                ref={(el) => {
                  if (el) refs.current.set(s.id, el);
                  else refs.current.delete(s.id);
                }}
                hidden={hidden.has(s.id)}
                className="scroll-mt-6"
              >
                <h2 className="mb-4 flex items-center gap-2.5 text-xl font-semibold tracking-tight text-ink">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <Icon size={17} />
                  </span>
                  {s.title}
                </h2>
                {s.body}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

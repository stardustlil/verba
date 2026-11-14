# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目

Verba 是打字背英文短语的桌面应用：Tauri 2（Rust）+ React 19 + TypeScript + SQLite，数据只存在本机。界面、注释、提交信息、文档都用中文，代码标识符用英文。

术语：界面和 README 里叫“短语”，代码里叫 `chunk`；注释和 AI 提示词里的“句块”是旧称，指同一个东西。

## 常用命令

```bash
npm install
npm run tauri dev                      # 开发（同时启动 Vite 和 Rust）
npm run tauri build                    # 构建安装包

npm test                               # 全部前端测试（vitest）
npx vitest run src/repo/books.test.ts  # 单个测试文件
npx vitest run src/repo -t "删除文章"   # 按名称筛选
npm run lint
npm run typecheck
npm run format                         # prettier 写回；format:check 只检查

cargo test --manifest-path src-tauri/Cargo.toml                 # Rust 测试
cargo test --manifest-path src-tauri/Cargo.toml migration_004   # 单个 Rust 测试
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets

npm run eval:extract                   # 用真实 AI 接口评测短语抽取，需要 DEEPSEEK_API_KEY
```

提交前要全部通过的检查，与 CI 的 `check` 任务一致：`format:check`、`lint`、`typecheck`、`test`，再加 `cargo test`。CI 用 Node 24；测试依赖 Node 自带的 `node:sqlite`。

## 架构

分四层，依赖方向只能自上而下：

| 层       | 位置        | 职责                                                                                                                                          |
| -------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 界面     | `src/ui`    | React 页面。与 Rust 的全部调用集中在 `services.ts`                                                                                            |
| 数据层   | `src/repo`  | **所有 SQL 都写在这里**（TypeScript），通过 `Db` 接口的 `query` / `transaction` 执行                                                          |
| 业务规则 | `src/core`  | 纯函数：`extract`（AI 抽取与校验、去重）、`judge`（判分）、`srs`（评级、FSRS 调度、出题队列、学习日）、`text`（清理、分句）。不碰数据库和界面 |
| Rust 端  | `src-tauri` | 只做这几件事：通用的 SQLite 执行器与迁移（`db.rs`）、抓网页与转发 AI 请求（`net.rs`）、保管 API key 和读文件（`settings.rs`）                 |

由此得出的规则：

- 不在 Rust 里写业务逻辑，也不为某个功能新增专用的数据库命令；前端把 SQL 发给 `db_query` / `db_transaction`。
- 不在组件里写 SQL，不在 `core` 里读写数据库。
- API key 只存在 Rust 端（数据目录下的 `config/secrets.json`），由 `ai_chat` 注入请求，前端只拿得到遮盖后的形式。

`Db` 接口有两个实现：应用里是 `tauriDb`（调用 Rust），测试里是 `repo/testing/nodeDb.ts`（`node:sqlite` 内存库，执行同一批迁移脚本）。所以数据层和练习流程都能脱离 Rust 测试。

### 数据模型要点

- `chunks` 是短语（同一原形的不同义项是不同的行，`lemma_key` 相同）。`examples` 是例句，来自文章（`article_id`、`sentence_id`）或来自词书（`book_id`），二选一，另一边为 `NULL`。写涉及 `article_id` 的条件时注意 `NULL`：要用 `IS NOT`，`!=` 会把词书例句漏掉。
- 时间一律是毫秒时间戳。“学习日”是 `'YYYY-MM-DD'`，凌晨 4 点分界，只能用 `core/srs/day.ts` 计算。文本偏移是 UTF-16 码元下标。
- 删除短语是软删除（`deleted_at`），下次启动时才彻底清除，所以查询 `chunks` 都要带 `deleted_at IS NULL`。
- 每个短语每天只有第一次答题计入调度和升降级（`reviews.counted = 1`），本轮重出的只写记录。
- 阶段 `new → cloze → recall`；一轮练习的出题顺序是 复习 → 跟写 → 填空 → 默写，队列逻辑在 `core/srs/session.ts`，界面流程在 `ui/practice/PracticePage.tsx`。
- `days` 与 `day_due` 记录每个学习日开始时到期的复习快照，用来算打卡和连续天数。
- 设置、当前词书、各词书的版本号都在 `meta` 表里。

### 内置词书

`src/data/books/*.json` 随应用发布，启动时由 `seedBuiltinBooks`（`repo/books.ts`）按 `version` 写入数据库。改动某本书的内容后必须把它的 `version` 加一，否则已安装的用户不会更新。词书由 `scripts/books/` 生成，来源与许可见 `src/data/books/SOURCES.md`。

### 迁移

- 脚本在 `src-tauri/migrations/NNN_名称.sql`，按编号顺序执行，`PRAGMA user_version` 等于已执行的个数。
- 新增迁移要同时在 `src-tauri/src/db.rs` 的 `MIGRATIONS` 数组里登记。测试用的 `nodeDb` 会自动读目录，Rust 端不会，漏了登记时前端测试照样通过。
- 迁移期间外键检查是关闭的，提交前会做一次 `foreign_key_check`。
- **已经合入 `main` 的迁移不能再改**，要调整只能新增一个。
- `tauri dev` 和安装版共用同一个数据目录（标识 `com.verba.desktop`）。开发迁移、或需要可以随意破坏的数据时，换一个标识运行：

```bash
npm run tauri dev -- --config '{"identifier":"com.verba.dev"}'
```

## 测试

- vitest 默认是 node 环境。需要 DOM 的测试文件在第一行写 `// @vitest-environment jsdom`。
- 界面测试用 `vi.mock("../services", …)` 把 `db` 换成 `createNodeDb()`，按真实的键盘操作走流程，参考 `ui/practice/PracticePage.test.tsx`。jsdom 里没有 `matchMedia`，用到 `theme.ts` 的页面要 mock `../theme`。
- 修 bug 时先写一个能复现的测试，确认它在修复前失败。
- React 开发模式（StrictMode）会把 effect 执行两遍，启动流程和页面加载都可能并发执行两次；写启动时的数据库操作要考虑这一点。

## 改动时要同步的地方

- 改了练习的按键、判分或评级规则：同步 `ui/pages/GuidePage.tsx`（应用内的使用说明）和 README 里的快捷键表。
- 改了 AI 提示词（`core/extract/prompt.ts`、`sense.ts`）：跑一次 `npm run eval:extract` 看实际效果。
- 颜色、字体、动画等设计令牌定义在 `src/styles.css`；英文展示文字用 `font-display`。

## 工作流程

### 分支

`main` 必须随时可以发布，发布用的标签从它上面打。

- 一次提交就能完成的小改动（修复、文字、样式）直接提交到 `main`。
- 以下情况开一个短期分支，并开 PR 让 CI 先跑（PR 会触发三个系统的构建）：要做好几天的功能；改数据库结构或新增迁移；改动练习流程、判分、调度这类核心逻辑。
- 合并的条件：CI 通过；功能完整到可以用；在运行的应用里实际试过。合并后删除分支。不设 `develop` 之类的常驻分支。

### 提交

- 只在用户要求时提交和推送。
- 提交信息用中文：一行标题概括改了什么；改动多时正文分条说明。

### 更新日志

`CHANGELOG.md` 记录用户能感知的改动。做了这类改动（新功能、修复、界面或规则变化）时，在最上面的 `## [未发布]` 一节下加一条；重构、测试、脚本的改动不用写。

### 发布

发布的时机：修了影响用户的 bug（尤其是可能丢数据的）就发修复版（`0.1.0 → 0.1.1`）；攒够一批用户能感知的功能时发功能版（`0.1.0 → 0.2.0`）。只有内部改动时不发版。

步骤：

1. 把 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 三处的版本号改成新版本，并运行一次 `cargo check --manifest-path src-tauri/Cargo.toml` 让 `Cargo.lock` 同步。
2. 把 `CHANGELOG.md` 里的 `## [未发布]` 改成 `## [新版本号] - 日期`（方括号里不带 `v`）。
3. 提交并推送，等 `main` 上的 CI 通过。
4. 打标签并推送：`git tag v0.1.1 && git push origin v0.1.1`。

推送标签后 `.github/workflows/release.yml` 会检查三处版本号与标签一致、从 `CHANGELOG.md` 取出这一版的说明，然后构建三个系统的安装包并发布。版本号不一致或找不到这一版的说明时会直接失败。安装包不做代码签名。

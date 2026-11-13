<div align="center">

<img src=".github/assets/logo.svg" width="88" height="88" alt="Verba" />

# Verba

**打字背英文句块的桌面应用**

从你读的文章里挑出值得记的搭配和短语，用打字的方式一遍遍写出来，按间隔重复的节奏记住它们。

![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-local-003B57?logo=sqlite&logoColor=white)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)
![License](https://img.shields.io/badge/license-MIT-green)

<img src=".github/screenshots/home.png" width="760" alt="Verba 首页" />

</div>

## 为什么是句块

单词背得再多，写作和口语里还是凑不出地道的说法。真正好用的是成块的表达：_take advantage of_、_in the wake of_、_draw widespread attention_。Verba 只做一件事：把这些句块从语境里拿出来，让你亲手打出来，直到能脱口（脱手）而出。

## 特性

- ⌨️ **原位打字练习**：字母直接打在题目上，没有输入框。一轮按 **复习 → 跟写 → 语境填空 → 纯中文默写** 推进，答错的要照着正确答案再打一遍，稍后还会重出
- 📚 **内置三本原创短语书**：高频动词短语、介词短语与固定表达、写作常用搭配，每本约 200 条，含例句和翻译，打开就能学
- ➕ **额外练习**：每日任务之外，一键再学 30 个新句块，不占用、不改变每天的新句块额度
- 🧠 **自动排期**：基于 [FSRS](https://github.com/open-spaced-repetition/ts-fsrs) 的间隔重复，评级和复习时间全部由程序根据你的作答自动决定
- 📰 **从你的文章里学**：粘贴英文文字、网址或拖入 txt / md 文件，AI 帮你抽取句块（默认 DeepSeek，兼容任何 OpenAI 格式的服务）；不填 key 也能选中文字手动添加
- 🔊 **声音反馈**：系统语音朗读句块和例句；打字有击键声、打错字母的提示音、答对 / 答错的结果音，都可以单独关闭
- 🎯 **宽容但严格的判分**：大小写、标点、英美拼写、缩写、人称代词（someone / sb）都按等价处理；“我写的也对”可以把你的写法存为备选答案
- 🌗 **亮色 / 暗色主题**，全程键盘操作
- 🔒 **本地优先**：无账号，数据只存在本机 SQLite 里

<table>
  <tr>
    <td><img src=".github/screenshots/practice.png" alt="语境填空练习" /></td>
    <td><img src=".github/screenshots/books.png" alt="词书" /></td>
  </tr>
  <tr>
    <td align="center">语境填空：在例句的空白处直接打字</td>
    <td align="center">词书：选一本开始学</td>
  </tr>
</table>

## 下载安装

在 GitHub Actions 的构建产物中下载对应系统的安装包，或按下面“开发”一节自行构建：

| 系统    | 安装包                        |
| ------- | ----------------------------- |
| macOS   | `.dmg`                        |
| Windows | `.msi` / `.exe`               |
| Linux   | `.deb` / `.rpm` / `.AppImage` |

安装包没有代码签名：

- **macOS**：第一次打开时若提示“无法验证开发者”，在“系统设置 → 隐私与安全性”中点“仍要打开”；或在终端执行 `xattr -dr com.apple.quarantine /Applications/Verba.app`
- **Windows**：SmartScreen 提示时点“更多信息 → 仍要运行”

## 快速上手

1. **选词书**：默认从《高频动词短语》开始，在“词书”页可以换一本
2. **开始学习**：首页按 <kbd>Enter</kbd>。每日新句块数在设置里调整（默认 20）
3. **还想多练**：点首页的“额外练习 30 个”，或在一轮结束时点“再练 30 个”
4. **导入文章**（可选）：在设置里填写 API key，然后在“文章”页导入

### 快捷键

练习全程可以只用键盘（Mac 用 <kbd>Cmd</kbd>，Windows / Linux 用 <kbd>Ctrl</kbd>）：

| 快捷键                                 | 作用                             |
| -------------------------------------- | -------------------------------- |
| <kbd>Enter</kbd>                       | 提交答案；看完结果后进入下一题   |
| <kbd>空格</kbd>                        | 答完一题后进入下一题             |
| <kbd>Tab</kbd>                         | 查看答案（之后要照着输入一遍）   |
| <kbd>Cmd/Ctrl</kbd> + <kbd>Enter</kbd> | “我写的也对”（答错后可用）       |
| <kbd>Cmd/Ctrl</kbd> + <kbd>E</kbd>     | 修改中文释义                     |
| <kbd>Cmd/Ctrl</kbd> + <kbd>D</kbd>     | 删除句块                         |
| <kbd>Cmd/Ctrl</kbd> + <kbd>Z</kbd>     | 撤销刚才的删除                   |
| <kbd>Cmd/Ctrl</kbd> + <kbd>P</kbd>     | 朗读                             |
| <kbd>Esc</kbd>                         | 退出本轮练习；编辑释义时取消编辑 |

## 数据与隐私

| 系统    | 数据目录                                          |
| ------- | ------------------------------------------------- |
| macOS   | `~/Library/Application Support/com.verba.desktop` |
| Windows | `%APPDATA%\com.verba.desktop`                     |
| Linux   | `~/.local/share/com.verba.desktop`                |

- 学习数据在 `verba.db`（SQLite），API key 单独存放在 `config/secrets.json`（仅当前用户可读）。设置页的“打开数据文件夹”可以直接打开这个目录；备份时请先退出应用再复制
- 朗读使用系统自带的语音，音效由程序现场合成，都不联网
- 只有导入文章时，你选中的段落会发送到你配置的 AI 服务用于抽取句块；除此之外应用不联网

## 开发

需要 Node.js 22+ 和 Rust stable，以及 [Tauri 的系统依赖](https://tauri.app/start/prerequisites/)。

```bash
npm install
npm run tauri dev
```

| 命令                                              | 作用                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `npm test`                                        | 前端单元测试（Vitest）                                            |
| `npm run typecheck`                               | TypeScript 类型检查                                               |
| `npm run lint`                                    | ESLint                                                            |
| `npm run format:check`                            | Prettier 格式检查                                                 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust 测试                                                         |
| `npm run eval:extract`                            | 用真实 AI 接口评测句块抽取效果（需要环境变量 `DEEPSEEK_API_KEY`） |
| `npm run tauri build`                             | 构建当前系统的安装包，输出在 `src-tauri/target/release/bundle`    |

CI（`.github/workflows/ci.yml`）在 Ubuntu 上跑格式检查、lint、类型检查和单元测试，然后在 macOS、Windows、Linux 上跑 Rust 测试并构建安装包。

### 技术栈

- **桌面框架**：[Tauri 2](https://tauri.app/)（Rust 端负责 SQLite、抓取网页、转发 AI 请求、保管 API key）
- **界面**：React 19、TypeScript、Tailwind CSS 4、[Lucide](https://lucide.dev/) 图标
- **数据**：SQLite（[rusqlite](https://github.com/rusqlite/rusqlite)），迁移脚本在 `src-tauri/migrations`
- **复习调度**：[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)
- **正文提取**：[@mozilla/readability](https://github.com/mozilla/readability)

### 代码结构

```
src/core      业务规则，纯函数：文本清理与分句、句块抽取、判对错、复习调度
src/repo      数据读写
src/data      内置词书（原创内容，JSON）
src/ui        界面
src-tauri     Rust 端
```

切分、判对错、评级、复习调度全部是确定的规则，写成 TypeScript 纯函数并有单元测试；AI 只在导入文章时用于抽取句块。

## 致谢

- [TypeWords](https://github.com/zyronon/TypeWords)（[typewords.cc](https://typewords.cc)）：Verba 的练习交互——原位打字、逐字母判错、跟写到默写的节奏——参考了这个优秀的开源打字背单词项目。Verba 只借鉴了交互思路，没有使用其代码
- [FSRS](https://github.com/open-spaced-repetition)：开源的间隔重复算法
- [VarCon](https://github.com/en-wl/wordlist)：英美拼写对照数据，许可声明见 [src/core/judge/SPELLING-DATA-LICENSE.txt](src/core/judge/SPELLING-DATA-LICENSE.txt)
- [Tauri](https://tauri.app/)、[React](https://react.dev/)、[Tailwind CSS](https://tailwindcss.com/)、[Lucide](https://lucide.dev/) 以及其他所有依赖的作者

## 许可证

[MIT](LICENSE)

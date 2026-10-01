# Reader

本地优先的 EPUB / PDF AI 阅读器。React + TypeScript + shadcn/ui（Base UI），Electron 桌面外壳，Go + SQLite 本地服务。PDF 使用 PDF.js Viewer，EPUB 使用 Readium Web 与 Go Toolkit。

## 启动

需要 Node.js 22+、pnpm 10、Go 1.26+。在项目根目录运行：

```sh
pnpm install
pnpm desktop
```

桌面启动命令会构建 Go、Web 和 Electron，打开 Reader 窗口。本地服务使用随机 loopback 端口，并随窗口关闭。若 Electron 二进制未自动下载，运行 `node apps/desktop/node_modules/electron/install.js`。

开发模式：

```sh
pnpm dev
```

终端会打印带本次会话 token 的 `http://127.0.0.1:5173/#token=…` 地址。用完整地址打开。Go 使用 `127.0.0.1:17840`，Vite 将 API 和出版物请求代理给它。Token 只用于本机服务会话，不是 AI 账号凭据。不要把该地址分享给他人。

## 这一版能做什么

- 导入、拖入 EPUB/PDF，保留原文件，内容去重；书库搜索、最近阅读、收藏。
- PDF 连续滚动、目录、页码跳转、缩放/适宽、文本选区、逐页文字搜索。
- EPUB 目录、章节导航、分页/滚动、字号/字体/行距/页边距、浅色/纸张/深色、Readium locator 进度恢复、FTS5 书内搜索。
- 书签、选区高亮、下划线、笔记、Markdown 导出。PDF 保存归一化选区矩形，EPUB 使用 Readium 装饰接口。
- 选区翻译/解释、多选区引用、当前章节或 PDF 页总结、对话历史；SSE 输出和取消。
- 检测本机 Claude Code / Codex CLI 的安装和登录状态。通过官方 CLI 使用已有账户，无需在 Reader 中填写 Key。

空书库可点击“先体验示例文档”。附带一份原创三章 EPUB 和一份两页 PDF；它们是测试内容，未伪装成已发表论文。

## AI 登录

先在终端安装并登录相应的官方 CLI：

```sh
codex login
claude auth login
```

在 Reader 的设置中点击“检测”，再在 AI 面板选择 provider。Reader 不读取 credential 文件、不实现 OAuth，也不自动安装 CLI。AI 的账户与计费方式由 CLI 登录决定；订阅额度、网络与模型可用性同终端。Reader 使用 CLI 默认模型。

只有主动发送问题时，选区或当前章节/页面与最近对话会通过 stdin 交给 CLI。Claude 禁用工具、MCP 和自定义配置；Codex 使用 read-only sandbox、禁用 shell、忽略用户配置与规则。CLI 运行于新建的空目录。Reader 不会让 AI 修改书库。当前桥接要求支持所用参数的近期 CLI 版本；旧版可能需要升级。Codex 的回答以完整消息事件到达，Claude 支持增量文字事件。

## 本地数据

桌面模式：Electron `userData/library`（macOS 开发版位于 `~/Library/Application Support/Reader/library`）。开发模式：根目录 `.reader/`。

```text
reader.sqlite          文档、阅读进度、批注、对话、设置、FTS5
books/                 EPUB 原文件
papers/                PDF 原文件
cache/<document-id>/   Readium manifest、positions 与处理后的 EPUB 资源
ai-work/               CLI 临时工作目录，请求结束即移除
```

关闭应用后可复制整个 library 目录备份。应用只监听 loopback；API 使用启动时随机 token，校验 Host/Origin；EPUB 导入限制压缩包大小、路径与活动内容。原文件不受正文处理影响。

## 验证与人工验收

```sh
pnpm typecheck
pnpm test
pnpm build
```

测试覆盖 Go 导入/去重/进度/批注/资源/Range/认证/不可信内容/模拟 CLI，以及 PDF.js 对真实 PDF 测试文件的解析。构建成功不等于界面验收。

人工检查：导入两种示例 → 点击目录 → 翻页或滚动 → 选择文字保存笔记 → 返回书库再打开，检查位置与批注 → 切换主题和 EPUB 字号 → 在设置检测 CLI → 发出问题并尝试停止 → 关闭窗口并重开，确认数据保留。检查命令面板 `⌘/Ctrl K`、导入 `⌘/Ctrl O`，AI 输入框 `⌘/Ctrl Enter` 发送。

## 当前限制

尚未支持 DRM EPUB、OCR、密码 PDF 输入、PDF 缩略图、后台 PDF FTS、批量翻译、跨文档 AI 检索、独立多会话管理、Ollama/API provider、统计、自动更新及签名安装包。EPUB 搜索使用 FTS5，并以字面子串匹配补足中文短词。PDF 搜索按页返回；复杂跨页选区暂不创建高亮。仅验证 macOS 开发环境；固定版式 EPUB、竖排、RTL 与大文件需要真实文档人工回归。

Electron 已接入 macOS open-file 事件，但未注册系统文件关联。开发目录可直接运行，尚未制作可分发安装包。

## 结构与文档

`apps/desktop` / `apps/web` / `apps/server`，以及 `packages/ui` / `packages/reader-core` / `packages/api-client`。没有 Nx/Turborepo。

[本轮范围](docs/spec.md) · [后续阶段](docs/roadmap.md) · [OpenAPI](docs/openapi.yaml) · [第三方来源](docs/sources.md)

`pnpm api:generate` 从 OpenAPI 重新生成类型。shadcn 组件来自官方 Base Nova registry；为本项目调整了 import alias 和 Lucide 图标。数据库结构围绕 Document；书签以 Annotation.kind=bookmark 存储，单文档会话以 messages 存储，这些是首版的明确简化。

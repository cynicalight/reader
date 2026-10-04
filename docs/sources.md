# 技术来源与归属

EasyRead 是产品交互参考。本项目从空目录独立实现，没有复制其 Python 服务或前端源码。

- [EasyRead](https://github.com/Edwardxlai/easyread)：本地 AI 阅读、批注与 CLI 账户使用方式的参考。
- [shadcn Vite 安装](https://ui.shadcn.com/docs/installation/vite)、[Base UI Button](https://ui.shadcn.com/docs/components/base/button)：`packages/ui/src/components` 从官方 `https://ui.shadcn.com/r/styles/base-nova/{name}.json` 获取，保留 Base UI primitive 和组件样式，替换本地 import alias 与 registry 图标占位符。
- [shadcn/ui 源码与 MIT 许可](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md)。Copyright (c) 2023 shadcn。
- [Readium TypeScript Toolkit](https://github.com/readium/ts-toolkit)：Navigator、Locator、Decoration；锁定 navigator 2.11.1、shared 2.6.0，遵循其依赖配对。BSD-3-Clause。
- [Readium Go Toolkit](https://github.com/readium/go-toolkit)：EPUB metadata / navigation / positions / font deobfuscation。v0.16.1，BSD-3-Clause。
- [PDF.js](https://mozilla.github.io/pdf.js/examples/)：渲染、文字层、注释层、outline、文本提取。Apache-2.0。
- [Codex 非交互模式](https://developers.openai.com/codex/noninteractive)、[CLI reference](https://developers.openai.com/codex/cli/reference)：`login status`、sandbox 和 stdin。流式适配使用 [Codex App Server](https://learn.chatgpt.com/docs/app-server) 的 `item/agentMessage/delta`，并核对本机生成的 JSON Schema。
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)：`auth status`、print/stream-json、禁用工具和 session persistence。

本次实现也核对了安装在本机的 `codex exec --help`、`claude --help`，未读取账号凭据。

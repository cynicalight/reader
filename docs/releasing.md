# 安装包构建与发版

Reader 使用 GitHub Actions 和 electron-builder，发布 GitHub Release 后自动生成以下文件：

| 文件                             | 运行平台                        |
| -------------------------------- | ------------------------------- |
| `Reader-<version>-mac-arm64.dmg` | Apple Silicon Mac               |
| `Reader-<version>-mac-x64.dmg`   | Intel Mac                       |
| `Reader-<version>-win-x64.exe`   | Windows x64，NSIS 安装程序      |
| `SHA256SUMS.txt`                 | 上述三个安装包的 SHA-256 校验值 |

当前没有开发者证书。macOS 应用采用 ad-hoc 签名，不做 Apple 公证；Windows 安装包不做代码签名。系统可能阻止首次打开。macOS 可在确认下载来源后，在“系统设置 → 隐私与安全性”中允许该应用；Windows 若显示 SmartScreen，可在确认来源后选择“更多信息 → 仍要运行”。组织设备策略可能禁止绕过。无需关闭系统整体安全保护。校验值用于检查文件完整性，不能替代开发者身份签名。

## 发版步骤

1. 在独立 worktree/分支完成修改，将根目录 `package.json` 和 `apps/desktop/package.json` 的版本同步，例如都改为 `0.2.0`。提交后 merge 到 `main`。
2. 推送 `main`，等待 CI 三个平台检查通过。首次启用时，可先从 Actions 手动运行 **Release installers**；它只保存安装包与校验值为 Actions artifacts，不创建或修改 Release。
3. 在所需提交上创建 tag，例如 `v0.2.0`，并发布该 tag 对应的 GitHub Release。Release 所在提交必须包含本工作流。预发布版本可用 `0.2.0-beta.1` / `v0.2.0-beta.1`。
4. **Release installers** 将 tag 解析为固定提交，核对版本，分别在原生 macOS ARM64、macOS Intel、Windows x64 runner 上构建。所有平台通过后，统一上传三个安装包与校验值到同一个 Release。
5. 下载并做安装后的人工检查：打开应用，导入 EPUB/PDF，确认阅读、笔记保存及重新打开后恢复；退出后检查服务已停止。AI 功能另用已安装并登录的 CLI 检查。

触发事件为 `release: published`，适用于正式版和预发布版。保存草稿、单独推送 tag 或修改 Release 描述不会触发。Release 页面会先发布，安装包稍后上传；任一构建失败时上传任务不会运行。GitHub 资产上传不是事务操作，上传过程中网络失败可能留下部分文件；修复后重新运行工作流会覆盖同名资产。不要移动已发布的 tag；代码修复请发布新版本。

工作流只使用仓库自动提供的 `GITHUB_TOKEN`，无需证书或 PAT。构建任务只有 `contents: read`，上传任务才有 `contents: write`。若以后由另一个工作流创建 Release，需要注意：默认 `GITHUB_TOKEN` 产生的事件通常不会触发新的工作流；应改为显式调用构建工作流，或调整发布入口。

## 本地构建

在目标平台、目标架构上安装 Go（版本见 `apps/server/go.mod`）、Node.js 22 和 pnpm 10.30.3，然后执行：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm package:dir  # 构建未封装应用，并检查包内运行时
pnpm package      # 构建 dmg/exe，并执行相同检查
```

产物在根目录 `release/`。脚本不上传任何文件。暂不支持交叉打包、Linux 安装包、Windows ARM64 或自动更新。安装包目前使用默认 Electron 图标。

安装包包含 Electron、Go 服务、Web 资源及 PDF 处理器的生产依赖。终端用户无需安装 Node.js 或 Go。PDF 布局模型仍按现有逻辑在首次处理时下载并缓存；安装包不包含模型。Codex、Claude Code、Kimi Code 仍需用户自行安装及登录。

`pnpm package` 会先执行完整 `pnpm build`。PDF 处理器使用 workspace 锁文件部署为独立依赖目录，再裁剪其他平台的 ONNX 二进制；所有原生依赖必须来自当前 runner。临时 staging 和产物被 Git 忽略。

## 自动检查的范围

PR 和 `main` CI 在三个平台运行类型检查、Go/前端测试、应用构建及打包目录检查。Release 和手动试跑额外生成安装程序。检查脚本从临时工作目录启动包内 Electron 的 Node 模式，验证 PDF.js 渲染、原生 canvas 和真实 ONNX 推理；随后启动包内 Go 服务，检查 SQLite 初始化、loopback 绑定、API 鉴权和 Web 资源。macOS 还检查 ad-hoc 签名完整性。

这些检查不启动 GUI，也不代替 DMG 挂载、Windows 安装/卸载、Gatekeeper/SmartScreen 以及真实用户文档的人工验收。校验生成脚本检查三份产物的命名、数量、文件头/尾和大小，再计算哈希。

## 相关文件与依据

- `.github/workflows/ci.yml`：PR/main 验证。
- `.github/workflows/build.yml`：三个平台共用构建任务。
- `.github/workflows/release.yml`：固定源提交、构建并上传安装包。
- `apps/desktop/builder.config.cjs`：安装包格式、资源路径和签名策略。
- `scripts/package.mjs`、`scripts/package-smoke.mjs`、`scripts/processor-smoke.mjs`：资源部署与包内运行验证。
- [GitHub release 事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release)、[runner 平台](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)、[GITHUB_TOKEN 触发限制](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow)。
- [electron-builder macOS 签名配置](https://www.electron.build/v26/docs/mac/)、[安装包资源配置](https://www.electron.build/v26/docs/configuration/)。

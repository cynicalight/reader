# 安装包构建与发版

Reader 使用 GitHub Actions 和 electron-builder，发布 GitHub Release 后自动生成以下文件：

| 文件                             | 运行平台                |
| -------------------------------- | ----------------------- |
| `Reader-<version>-mac-arm64.dmg` | Apple Silicon Mac       |
| `Reader-<version>-win-x64.exe`   | Windows x64（NSIS）     |
| `SHA256SUMS.txt`                 | 安装包的 SHA-256 校验值 |

当前工作流不构建 Intel Mac、Windows ARM64 或 Linux 安装包。

当前没有 Apple 开发者证书。macOS 正式版使用仓库固定的自签名证书签名（见下文“macOS 签名证书”），不做 Apple 公证；Gatekeeper 不信任该证书，表现与 ad-hoc 签名相同。Windows 安装包没有 Authenticode 签名。系统可能阻止首次打开。macOS 可在确认下载来源后，在“系统设置 → 隐私与安全性”中允许该应用；Windows SmartScreen 可选择“更多信息 → 仍要运行”。组织设备策略可能禁止绕过。无需关闭系统整体安全保护。校验值用于检查文件完整性，不能替代开发者身份签名。

## macOS 签名证书

Squirrel.Mac 只安装与当前应用出自同一证书的更新。所有正式版必须使用同一张自签名证书；丢失或更换证书后，已安装的版本无法原地更新，只能手动下载 DMG 一次。

首次启用时在本机执行一次，输出目录必须不存在：

```sh
scripts/create-mac-sign-cert.sh ~/reader-mac-sign
gh secret set MAC_SIGN_P12 < ~/reader-mac-sign/reader-sign.p12.base64
gh secret set MAC_SIGN_P12_PASSWORD < ~/reader-mac-sign/password.txt
```

把 `reader-sign.p12` 和 `password.txt` 离线备份后，可删除本机副本。证书有效期 20 年，CN 为 `Reader Self-Signed`。

`apps/desktop/mac-sign.cjs` 是 electron-builder 的 `mac.sign` 钩子：electron-builder 照常生成签名参数，钩子把证书导入临时钥匙串，替换签名身份后逐个签名嵌套二进制，结束后删除临时钥匙串，不修改登录钥匙串或信任设置。证书无人验证时间戳，签名不请求 Apple 时间戳服务。没有证书时退回 ad-hoc 签名，适用于本地构建和手动试跑；带 Release tag 的构建缺少证书会直接失败，包内检查也会确认签名者为 `Reader Self-Signed`。证书只传给 macOS 构建任务。

## 发版步骤

1. 在独立 worktree/分支完成修改，将根目录 `package.json` 和 `apps/desktop/package.json` 的版本同步，例如都改为 `0.2.0`。提交后 merge 到 `main`。
2. 推送 `main`，等待单个 Linux runner 的类型检查和测试通过。首次启用时，可先从 Actions 手动运行 **Release installers**；它只保存安装包与校验值为 Actions artifacts，不创建或修改 Release。
3. 在所需提交上创建 tag，例如 `v0.2.0`，并发布该 tag 对应的 GitHub Release。Release 所在提交必须包含本工作流。预发布版本可用 `0.2.0-beta.1` / `v0.2.0-beta.1`。
4. **Release installers** 将 tag 解析为固定提交，核对版本，分别在原生 macOS ARM64 和 Windows x64 runner 上构建。同一源提交已经通过的 `main` CI 会直接复用；没有成功记录时，先调用与日常 CI 相同的检查流程。检查通过后才构建安装包，两个平台都成功后统一上传安装包与校验值到同一个 Release。
5. 下载并做安装后的人工检查：打开应用，导入 EPUB/PDF，确认阅读、笔记保存及重新打开后恢复；退出后检查服务已停止。AI 功能另用已安装并登录的 CLI 检查。

触发事件为 `release: published`，适用于正式版和预发布版。保存草稿、单独推送 tag 或修改 Release 描述不会触发。Release 页面会先发布，安装包稍后上传；任一构建失败时上传任务不会运行。GitHub 资产上传不是事务操作，上传过程中网络失败可能留下部分文件；修复后重新运行工作流会覆盖同名资产。不要移动已发布的 tag；代码修复请发布新版本。

工作流使用仓库自动提供的 `GITHUB_TOKEN` 和上述两个 macOS 签名 secrets，无需 PAT。构建任务只有 `contents: read`，上传任务才有 `contents: write`。若以后由另一个工作流创建 Release，需要注意：默认 `GITHUB_TOKEN` 产生的事件通常不会触发新的工作流；应改为显式调用构建工作流，或调整发布入口。

## 本地构建

在目标平台、目标架构上安装 Go（版本见 `apps/server/go.mod`）、Node.js 22 和 pnpm 10.30.3，然后执行：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm package:dir  # 构建未封装应用，并检查包内运行时
pnpm package      # 构建 DMG 或 NSIS 安装包，并执行相同检查
```

产物在根目录 `release/`。脚本不上传任何文件。暂不支持交叉打包、Linux 安装包或 Windows ARM64。安装包目前使用默认 Electron 图标。

安装包包含 Electron、Go 服务、Web 资源及 PDF 处理器的生产依赖。终端用户无需安装 Node.js 或 Go。PDF 布局模型仍按现有逻辑在首次处理时下载并缓存；安装包不包含模型。Codex、Claude Code、Kimi Code 仍需用户自行安装及登录。

`pnpm package` 会先执行完整 `pnpm build`。PDF 处理器使用 workspace 锁文件部署为独立依赖目录，再裁剪其他平台的 ONNX 二进制；所有原生依赖必须来自当前 runner。临时 staging 和产物被 Git 忽略。

## 应用内更新

安装后的 Reader 会在启动 15 秒后检查是否已到每日检查时间。应用运行期间也会检查到期时间；应用关闭时不运行后台任务，下次启动会补查。检查时间保存在用户数据目录的 `update-state.json`，重启不会重置每日间隔。失败或 Release 安装包尚未上传完成时，至少间隔一小时再试。开发模式不访问更新 API。

更新来源为 `cynicalight/reader` 的最新正式 GitHub Release。仅提示比当前版本更新的正式版，不提示草稿、预发布版或旧版本。Release 必须同时提供当前平台（Apple Silicon Mac 或 Windows x64）对应的安装包和 `SHA256SUMS.txt`。在“关于 Reader”中可手动检查，手动检查不受每日间隔限制。

发现更新后选择“下载安装包”，应用会通过 Electron 网络栈下载文件，使用系统代理，并在本地核对 SHA-256。校验成功后：macOS 打开 DMG，请先退出 Reader，再将新 Reader 拖入 Applications 完成替换，应用不会自动退出；Windows 运行 NSIS 安装程序并退出 Reader（退出前照常保存阅读数据），由安装程序替换原安装目录，书库在用户数据目录中不受影响。下载文件保存在用户数据目录的 `updates/` 下；失败的下载会清理，进程被强制关闭可能留下 `.part` 文件。校验值确认文件与 Release 一致，不能替代开发者签名。

当前 macOS 采用 ad-hoc 签名；若要改用标准的自动下载、重启安装机制，需要另行配置可验证的应用签名和更新产物。参见 [Electron 自动更新要求](https://www.electronjs.org/docs/latest/api/auto-updater)与 [electron-builder 更新产物要求](https://www.electron.build/v26/docs/features/auto-update/)。

人工检查：安装含此功能的包，打开“关于 Reader → 检查更新”；确认无更新时提示当前版本。随后发布更高版本且安装包上传完成后，再检查并下载；确认 DMG 打开（Windows 为安装程序启动且 Reader 退出），安装后版本变化，原书库和阅读位置仍保留。选择“稍后”应继续阅读；断网时手动检查应提示错误。自动检查与真实系统安装仍需人工验收。

## 自动检查的范围

PR 和 `main` CI 只在 Ubuntu 上运行类型检查与 Go/前端测试，不构建应用或安装包。Release 和手动试跑固定源提交，按完整 SHA 查询本仓库 `ci.yml` 已成功的 push 检查；不复用其他提交、失败、未完成或 PR head 的记录。找不到可复用记录时先补跑同一检查流程，失败则停止发版。之后在原生 macOS ARM64 和 Windows x64 runner 上构建安装包并检查包内运行时，不重复跑整套测试。检查脚本先将整个应用复制到仓库以外的临时目录，再启动包内 Electron 的 Node 模式。这样可以避免漏装依赖时意外使用源码目录中的依赖。检查内容包括 PDF.js 渲染、原生 canvas 和真实 ONNX 推理。随后启动包内 Go 服务，检查 SQLite 初始化、loopback 绑定、API 鉴权和 Web 资源。macOS 还检查签名完整性，正式版要求签名者为固定证书。

这些检查不启动 GUI，也不代替 DMG 挂载、Gatekeeper、Windows 安装/卸载、SmartScreen 以及真实用户文档的人工验收。校验生成脚本检查 DMG 与 EXE 产物的命名、数量、文件头/尾和大小，再计算哈希。

## 相关文件与依据

- `.github/workflows/ci.yml`：单平台 PR/main 验证，也供发版补跑检查。
- `.github/workflows/build.yml`：Mac 与 Windows 构建任务。
- `.github/workflows/release.yml`：固定源提交、构建并上传安装包。
- `apps/desktop/builder.config.cjs`：安装包格式、资源路径和签名策略。
- `apps/desktop/mac-sign.cjs`、`scripts/create-mac-sign-cert.sh`：macOS 固定证书签名与证书生成。
- `scripts/package.mjs`、`scripts/package-smoke.mjs`、`scripts/processor-smoke.mjs`：资源部署与包内运行验证。
- [GitHub release 事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release)、[runner 平台](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)、[GITHUB_TOKEN 触发限制](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow)。
- [electron-builder macOS 签名配置](https://www.electron.build/v26/docs/mac/)、[安装包资源配置](https://www.electron.build/v26/docs/configuration/)。

# 前端流式迁移交付记录

工作树：`/Users/bu44er/Developer/Projects/Reader-streaming-frontend`。分支：`frontend/lobehub-streaming`。共同基线：`85f21938f13914c48131a455cb586d4e964b90c9`。前端实施仅修改自己拥有的文件；后端 Go、OpenAPI、生成类型和契约通过用户最新授权的任务分支合并引入。未复制主工作区未提交产品代码；不合入 main、不推送、不部署。

**交付边界：F1–F4 代码已接入正式聊天，自动检查和 Codex/Kimi 真实 HTTP 文字/图片联调通过；人工视觉/滚动验收、Claude 登录后的真实验证及最终协调集成未完成。因此不宣称“迁移验收完成”。**

## F1：统一 Markdown

锁定 `@lobehub/streamdown@1.4.0`，`MessageMarkdown` 统一历史/生成入口。ChatSession 保存收到的原始文本，remend 只修复显示副本；复制回答使用原文，代码按钮复制代码正文，修复符号不送存储。关闭 raw HTML；外部图片只显示 alt，不发网络请求。链接允许 http/https/mailto/局部锚点，外链提供复制链接，不增加 Electron IPC；脚注只控制对话 Viewport。SourceReferences 继续单独使用可信的 PDF/EPUB 位置。

生成中使用 Streamdown；无动画及终态使用同包 CachedMarkdown。脚注/引用式链接采用全文解析：检测全局引用后关闭分块流式动画，终态也全文解析；定义最后到达前可能暂时显示未解析引用。最终链接/脚注测试通过，但定义到达及终态切换时的真实布局仍待人工检查。

代码高亮评估了 Lobe UI `useStreamHighlight` / `@shikijs/stream`：其增量 tokenizer 需要额外维护重置/并发缓存。本轮独立实现 Shiki 高亮，100ms 合并调用，收到的代码立即显示；超过 24,000 字符保留纯代码，未知语言降级文本。未复制上游源码。仅加载 TS/JS/Go/Python/JSON/Bash/HTML/CSS grammar 和双主题，无 token 淡入。KaTeX 与上游统一为 0.18.1，trust=false、maxExpand=100、maxSize=20；公式组件、CSS/字体按需提供且离线可用。上游 Streamdown 的公式 guard 静态引用 KaTeX，所以 KaTeX 核心随 Markdown 异步 chunk 加载，并非只出现公式时才加载；Shiki 引擎/grammar 仍在代码出现后加载。

确定性样本含中文长段、中英混排、emoji/组合字符、标题、嵌套列表、引用、表格、行内/多语言代码、公式、脚注、引用式链接。逐字/按词/固定种子随机/全文模式最终原文及渲染一致，未完成语法、URL 边界和禁用图片/HTML有自动覆盖。未将 SSR/JSDOM 结果当作视觉验收。

## F2：Viewport 跟随

ScrollArea 仅扩展真实 Viewport ref/props。`useChatScroll` 监听实际滚动容器和内容 ResizeObserver；跟随时才调整 scrollTop。wheel/触摸/键盘上滚立即暂停；回到底部恢复；程序滚动单独辨识；卸载清理事件、Observer 和 rAF。不调用页面 scrollIntoView。

24px 为临时贴底阈值，待 250px 侧栏人工实测。自动覆盖暂停→高度变化不拉回→恢复与清理；字体/公式/高亮/侧栏缩放的真实布局、选择复制和展开收起仍待人工验收。消息临时行与数据库行共用稳定本地 key，避免保存同步时重新挂载整条回答。

## F3：动画与性能

按用户最新要求固定 Streamdown silky/word 控制视觉节奏，无速度选项；ChatSession 每帧合并发布，不添加逐字队列或传输缓冲。reduced motion、后台页面和超过 32,768 字符时关闭动画；本次消息后台恢复后保持即时显示。done/error/取消立即卸载动画调度并显示收到的原文，历史不重新播放。取消/终态/减少动态效果/后台恢复与清理有功能测试。

以下数值为切换 silky 之前 realtime 模式的历史测量，不代表最终 silky 数值。按用户避免过度测试的要求，不重跑性能矩阵。同机 Apple M3 Pro / arm64 / Darwin 25.6.0，Electron 44.5.1 / Chromium 152，Vite 开发构建、360px 宽。数值探针使用独立临时 profile 隐藏窗口，只记录数字，无截图、无视觉断言。样本每 4096 Unicode 字符 / 20ms；原始结果见 [benchmark JSON](./frontend-streaming-benchmark.json)。不是生产性能承诺。

初次全文解析基线的 1,048,500 字节无动画样本：147 次 commit、React 累计 40,851.3ms、135 个长任务共 43,152ms、终态提交 557.7ms。修正后，超过 32,768 字符且不含全局定义/公式的文本，按完整顶层 Markdown token 聚合约 8192 字符组，复用不变组，不切断列表/代码/表格。一次受 HMR 干扰的旧动画样本作废。以下是修正后同一代码的关闭/打开动画比较：

| 字节 | 动画 | commit | React 累计 ms | 最慢 commit ms | 长任务数/累计 ms | 终态提交/下一帧 ms | 堆 before/after/idle MB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10,240 | 关 | 4 | 31.6 | 17.2 | 0/0 | 0.6/4.9 | 18.3/20.0/20.0 |
| 10,240 | 开 | 6 | 62.1 | 40.0 | 0/0 | 10.1/10.3 | 18.2/28.6/28.3 |
| 102,399 | 关 | 17 | 291.9 | 42.9 | 0/0 | 3.5/5.0 | 19.2/30.6/30.8 |
| 102,399 | 开 | 24 | 294.6 | 44.4 | 0/0 | 3.4/5.0 | 19.0/77.4/77.6 |
| 1,048,500 | 关 | 147 | 4252.9 | 53.6 | 2/105 | 33.1/33.2 | 40.2/342.3/344.0 |
| 1,048,500 | 开 | 154 | 4210.4 | 62.5 | 4/216 | 33.4/33.4 | 40.1/246.2/247.9 |

全部 idleCommits=0（结束后第 1–2 秒），不是长期泄漏排除。堆未强制 GC，不据此推断动画减少内存。大样本达到阈值后关闭动画，不能声称全 1MiB 都在逐词动画。含全局定义/公式、单个巨型块仍可能明显阻塞；未做虚拟列表，长历史 DOM/内存仍是限制。普通长段落路径已修正，其他限制保留给人工验收和后续优化。

生产构建同机比较基线 85f2193（git archive 到本工作树忽略目录，显式 SDK/UI 别名）与最终前端：入口 JS 612,520→621,395 字节，增加 8,875；Python gzip 198,086→201,173，增加 3,087。新增 Markdown 异步 JS 498,193（gzip 150,333），高亮核心 93,038（29,941），WASM 622,336（230,448）；CodeBlock 1,324，MathFormula 390，另有语言/主题 chunks。所有 JS 合计 1,720,668→3,590,621，增加 1,869,953；KaTeX 多格式字体合计 1,072,948 字节。CSS 基线扫描路径有差异，不作不可靠差值。Vite 仍提示 >500kB chunk。所有 Markdown/高亮资源不在初始入口强制加载，开发预览/benchmark 不进入生产导航。

复现数值：先启动下述开发预览，再运行 `READER_BENCHMARK_OUTPUT=<绝对输出路径> pnpm --filter @reader/desktop exec electron ../../apps/web/scripts/streaming-benchmark.cjs`。会执行六种样本，结束后退出自己的 Electron。

## F4：正式对话与冻结契约

Workspace 已移除高频 messages/stream 状态，独立 ChatSession store 驱动 AssistantPanel；Workspace 保留阅读器上下文、附件与编辑器。SDK 单点负责 UTF-8 fatal 解码、CRLF/CR/LF、多行 data、未知事件忽略、字段校验、终态门控、1MiB 原文/转义帧上限和 abort 清理。请求必填 provider 与五种 SSE 事件均未改变。

done 立即停止生成，再 GET messages。关联要求开始前 ID 集合、本次文档、唯一新用户/助手与顺序；旧的相同内容不会认作本次结果。无明确关联保留待同步。同步失败保留原文并可重试；error/取消/无 done 保留部分并区分状态；绝不自动重 POST。消息查询有 15 秒边界和 AbortSignal，dispose 同时中止传输/查询并使旧回调/finally失效。旧失败部分在后续请求时保留为本地未完成回答，不伪装落库。

后端提交 `439130d` 已交付同契约可运行服务。通过真正的前端 SDK+ChatSession 调用，而非仅验证后端适配器。只用仓库原创 EPUB 样本、原创提示和合成红蓝图片，不发用户书籍，context 为空。图片索引直接作为临时 fixture 准备，**不验证 PDF 版面提取/沉淀**，也不改后台产物。

| Provider | 输入 | 片段 | 首段 / done | 保存核对 | 首段取消后返回 |
| --- | --- | --- | --- | --- | --- |
| Codex 0.160.0 | 原创文字 | 231 | 10.570s / 17.201s | 通过 | 2.6ms，保留部分、查询记录 |
| Kimi 2.0.2 | 原创文字 | 247 | 6.616s / 12.271s | 通过 | 4.9ms，保留部分、查询记录 |
| Codex 0.160.0 | 合成图片 | 91 | 5.292s / 8.107s | 通过，附件 ID 保存 | 未单独做图片取消 |
| Kimi 2.0.2 | 合成图片 | 107 | 7.463s / 10.727s | 通过，附件 ID 保存 | 未单独做图片取消 |
| Claude Code 2.1.220 | 文字/图片 | 未验证 | 未登录 | 未验证 | 未验证 |

原始数字见 [live JSONL](./frontend-streaming-live.jsonl)。取消数值是前端请求退出/查询返回时间，不声称上游进程在该时间内完成清理；后端资源回收证据见其报告。共用后端 `docs/fixtures/agent-streaming-v1.json` 四组（success/fallback/partial-error/missing-terminal）逐字节消费通过。备用商业 API 未用真实密钥调用，不声称厂商端验证。Kimi 首次 smoke 的“助手总数=1”断言失败是重复导入相同文件被去重后复用历史导致，已改为以请求前记录数为基线，重跑通过；产品的前置 ID 关联在该运行中正常。

`backend-integration.test.ts` 默认跳过模型调用。复现需显式设置 `READER_INTEGRATION_READY=<0600 preview.json>`、`READER_INTEGRATION_PROVIDER=codex|kimi|claude`；共享 fixtures 可用 `READER_INTEGRATION_FIXTURES=<后端fixtures绝对路径>`。图片另设 `READER_INTEGRATION_IMAGE=streaming-synthetic-image` 并用 `-t 'real image'`。可设 `READER_INTEGRATION_OUTPUT=<绝对路径>` 记录无正文/无密钥 JSONL。token 不打印、不进 Git，不读取 CLI 凭据文件。

## 检查、预览与人工验收

正式检查：`pnpm typecheck` 通过；`pnpm test` Go 全部包通过，最终 Vitest 21 文件通过 / 1 文件默认跳过，78 测试通过 / 3 个 opt-in 联调测试默认跳过；`pnpm build` 通过。初次全量测试发现 SSR 测试卸载后高亮模块仍加载，已移入客户端 effect，并全量复跑无错误。测试覆盖传输分片、未完成 Markdown、终态去重、失败/取消保留、旧请求/查询隔离、同步失败重试、稳定行 key、减少动态与后台恢复、滚动意图/清理。JSDOM 不代表真实布局通过。

开发回放：`pnpm --filter @reader/web dev --port 15173`；已监听且 HTTP 200：[http://127.0.0.1:15173/__streaming](http://127.0.0.1:15173/__streaming)。不读取书库、不调用模型，默认关闭动画，四种分片和三档大样本可选择。

正式前端+已交付后端预览：`http://127.0.0.1:50351`，独立临时库，服务进程存活期间可用。状态文件（0600）：`/var/folders/1g/3yj40ngn5b33fs9gg0wzvms00000gn/T/reader-frontend-preview-3gM2qF/preview.json`。包含本机临时 token，未提交。以此命令打开带认证的本机页面（不打印 token）：

```sh
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); require("child_process").spawn("open",[r.url+"/#token="+r.token]);' /var/folders/1g/3yj40ngn5b33fs9gg0wzvms00000gn/T/reader-frontend-preview-3gM2qF/preview.json
```

重新启动：`node apps/web/scripts/start-streaming-preview.cjs <已验证后端reader-server绝对路径>`。该脚本只新建临时库、使用本前端 dist、自动选 loopback 端口并写 0600 状态文件。可运行 `python3 apps/web/scripts/seed-streaming-image.py <新preview.json>` 准备合成图片；只允许该脚本新建的临时库，不覆盖已有条目。

人工顺序：四种分片比较最终正文/链接；250px 侧栏深浅主题检查代码、表格、公式；生成中上翻选择复制并调整宽度，确认不拉回；回到底部恢复；系统减少动态；生成时停止检查尾字；后台恢复不补播；真实对话确认首段提前、最终无重复、取消、失败和同步重试。记录操作者/版本/结果。脚注晚到与终态替换位置、侧栏展开收起、Electron 实机尚未确认。未使用浏览器自动化作视觉验收。

集成前只读核对 main 仍为 `2afe113e8f02593da79b3ad5fbc5c8f1c721a639`。已通过授权的 codex queue 向协调会话报告主要阶段、性能问题及联调结果，未派活或打断原有会话。提交后由协调会话做联合人工验收和集成。

CLI 状态在本会话交付前再次核对：Codex 0.160.0、Kimi 2.0.2、Claude Code 2.1.220；Claude `auth status` 仅输出布尔值 `loggedIn=false`，未读取凭据文件。无契约接口阻塞；剩余环境阻塞是 Claude 登录及人工验收。

## 用户追加授权后的联合交付

前端实施提交：`dba1b34`。用户明确要求只使用 `smoothing="silky"`，不提供速度选项，避免过度测试；已照此修改，并保留既有减少动态/终态立即追齐逻辑。原性能表及构建尺寸是切换 silky 前的历史快照，不将其冒充最终 silky 性能。

用户明确授权在本 worktree 合入 `backend/unified-streaming@2b1a49f`，取代原先不合并任务分支的限制。合并提交 `29bbb8a`，无冲突；未合入 main。后端 `2b1a49f` 相对此前实际联调的 `439130d` 仅有进度文档更新，因此不重复 Codex/Kimi 模型矩阵。

联合分支的必要检查已完成：`pnpm typecheck` 通过；`pnpm test` 的 Go 全包通过（21.205s），Vitest 78 通过 / 3 个显式启用的真实测试默认跳过；`pnpm build` 通过。另以合并后的本地 `docs/fixtures/agent-streaming-v1.json` 执行 SDK writer-fixtures 测试通过（6ms）。减少动态、终态追齐和取消测试在 silky 配置下随全量测试通过。未重复性能矩阵或浏览器视觉测试。

预览 `http://127.0.0.1:50351` 使用本 worktree 的 dist，构建后即可刷新到 silky；后端二进制与已合入后端代码一致。人工验收与 Claude 未登录的边界仍保持，不声称未做的检查已完成。最终 smoothing/记录提交可由本分支 HEAD 查询；工作树清洁状态在提交后再次核对。

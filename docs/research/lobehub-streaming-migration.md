# LobeHub 流式渲染迁移到 Reader 的评估

调研日期：2026-10-05。Reader 基线：`922f17b4be5c8b33eff52c8e9c00ab91466ea983` 加当前工作区。调研开始时 `App.tsx`、`Settings.tsx`、`style.css` 已有未提交修改；本次不修改产品代码。

## 结论与证据边界

可以迁移流式 Markdown 的渲染能力。建议保留 Reader 的 Go 服务、POST SSE、Base UI 和文档引用模型，先用独立渲染包验证，再接入输出调度和滚动控制。直接复制 LobeHub 整个聊天模块会引入不必要的业务状态、组件体系和许可条件。

“业界最好”是体验判断。本次没有跨产品基准、真实浏览器性能采样或桌面视觉验收，不能据源码确认该排名。本文的“已确认”指源码与依赖声明；收益和工期均是待验证的工程判断。

LobeHub 具体实现、固定版本源码链接与许可证证据见 [上游调查](./lobehub-streaming-upstream.md)。以下重点说明 Reader 的接入位置和迁移边界。

## 应该迁移哪一层

LobeHub 当前代码把接收文本、平滑展示、Markdown 和滚动分层实现。其中 Markdown 的上层组件是 `@lobehub/ui`，流式分支使用 `@lobehub/streamdown`，静态分支仍使用 `react-markdown`。不是替换一个普通文本组件就能获得整个应用的体验。准确分支条件和调用链见上游调查。

| 方案 | 适配判断 | 本次建议 |
| --- | --- | --- |
| 直接用 `@lobehub/streamdown` | 同款底层；1.4.0 为 MIT、ESM，React/React DOM 19 peer，Node ≥22；不依赖 Ant Design。代码高亮、公式和交互控件需外部渲染器。 | 优先做小范围验证。保留 Reader 的 Base UI 和设计变量，在本地适配组件中封装。 |
| 用 `@lobehub/ui` Markdown | 更接近 LobeHub 的完整 Markdown 表现，已有高亮等集成；会引入其 UI、样式和相关依赖。 | 作为效果对照；实际体积、主题冲突和 primitive 适配通过构建后再决定，不能声称必然更重多少 KB。 |
| 复制应用的聊天模块 | 包含平滑、状态和滚动实现，但与 LobeHub 业务耦合；应用根许可证有额外条件。 | 不建议整体复制。借鉴分层与状态转换，按 Reader 需求实现调度。 |
| Vercel `streamdown` | 是另一个包，不是 LobeHub 底层。提供不完整 Markdown 处理、memo、可选公式/代码/CJK 插件；文档按 shadcn 设计变量集成。 | 若同款引擎的限制不适合 Reader，再进行对照验证；本次未做实测比较。 |

版本范围须区分：LobeHub 调研 commit 为 `08232e8efa324659d67a216b5e51bca5963ae19b`；根 package 声明范围不等于线上版本。受跟踪的桌面锁文件解析为 `@lobehub/ui@5.54.0` 与 `@lobehub/streamdown@1.4.0`。本次未确认线上网站实际部署版本。底层源码与 UI 版本证据见上游调查。

Vercel 候选来源：[官方 README](https://github.com/vercel/streamdown/blob/1ddd8f4accd87dfc0e933f257c9d6ffe0fa85ccc/README.md)、[包声明](https://github.com/vercel/streamdown/blob/1ddd8f4accd87dfc0e933f257c9d6ffe0fa85ccc/packages/streamdown/package.json)、[Apache-2.0 许可](https://github.com/vercel/streamdown/blob/1ddd8f4accd87dfc0e933f257c9d6ffe0fa85ccc/LICENSE)。该快照包版本为 2.7.0；仅作为备选资料，不是 Reader 新增依赖。

同款引擎有两个特别影响 Reader 的限制：跨 Markdown 块的脚注/引用式链接需要额外处理；reduced motion 的现有样式未覆盖全部字符动画。第一阶段应验证自定义处理或完成后整文档静态渲染，并在 Reader 的适配层禁用相关动画。论文的真实 `SourceReferences` 继续独立保留。流式转静态时也要检查重排，不能假设两个解析路径最终 DOM 完全一致。

许可证结论限定为源码文本：独立 UI 和流式包标记 MIT；应用使用 LobeHub Community License，包含商业衍生分发条件。正式采用时应保留所选包的版权和许可证，并核对新增依赖；不能把独立包的许可推及整个应用。

## Reader 当前真实链路

```text
Claude/Codex CLI，或图片/Kimi/备用 API
  → Go 提取回答、发送 status/delta/fallback/error/done
  → packages/api-client chat()：fetch + TextDecoder + SSE 分帧
  → Workspace.send()：setStream(previous => previous + text)
  → 普通 div 显示字符串，white-space: pre-wrap
  → messages/stream 更新时 scrollIntoView
  → 服务端保存成功发 done，客户端重新查询 messages 并清空 stream
```

| 环节 | 已确认的事实 | 对迁移的影响 |
| --- | --- | --- |
| 前端基础 | React 19.2、Vite 7、Zustand 5；尚无 Markdown 渲染依赖。见 [package.json](../../apps/web/package.json)。 | 可加入 React 渲染组件；无需为了 Markdown 替换框架。 |
| 流接收 | [chat()](../../packages/api-client/src/index.ts#L119) 携带 Bearer token 和 AbortSignal；解析增量并检查 done。 | 渲染包只需接收文本和生成状态，不必接管请求或认证。 |
| 状态范围 | [Workspace](../../apps/web/src/Workspace.tsx#L294) 持有 messages、stream、sending；每个 delta 调用 setStream。 | 更新会触发 Workspace 执行；实际 React commit 次数受批处理影响，尚未测量。应将高频状态移入 AI 面板。 |
| 消息内容 | [历史回答与临时回答](../../apps/web/src/Workspace.tsx#L1045) 都在普通 div 中显示。 | 表格、标题、代码、公式目前只是文本；引入 Markdown 是明确的功能增量。 |
| 滚动 | [effect](../../apps/web/src/Workspace.tsx#L330) 每次 messages/stream 变化都调用 scrollIntoView，没有“用户已上滚”的判断。 | 新渲染器不能自动修复此行为，需独立贴底策略。 |
| 样式 | [.chat-message](../../apps/web/src/style.css#L723) 继承 pre-wrap。 | Markdown 容器需要 normal，代码块另设 pre；窄侧栏中的表格与代码应局部横向滚动。 |
| 引用 | [SourceReferences](../../apps/web/src/SourceReferences.tsx#L22) 独立使用真实选区、PDF/EPUB 位置。 | 保留此组件，不将模型生成的 Markdown 链接当作可信文档位置。 |
| 完成与取消 | [send()](../../apps/web/src/Workspace.tsx#L438) 完成或失败后查库并清空临时文本，停止按钮使用 AbortController。 | 增加展示缓冲后必须定义 flush、取消与销毁；不改变服务端保存成功才确认完成的规则。 |

### 首字延迟受服务端路径限制

这里的“首字延迟”指发送问题后到用户看到第一段答案的时间。前端平滑只能处理已经到达的文本。

1. **纯文本 Claude**：[eventText](../../apps/server/internal/reader/ai.go#L74) 接受 `content_block_delta/text_delta`，可以逐段发送。
2. **纯文本 Codex**：同一函数只接受 `item.completed` 的 `agent_message`。这是当前 Reader 适配的边界；没有证据说明所有 Codex 接口都只能整段输出。本次未调研替代 Codex 协议。
3. **图片附件或 Kimi**：[路由](../../apps/server/internal/reader/ai.go#L131) 进入 imageChat；[generateWithConfig](../../apps/server/internal/reader/connections.go#L279) 调用主 provider 时传入 `nil` 增量回调，成功后一次 `delta(text)`。即使底层 CLI 能产生增量，这条主路径也会缓冲。
4. **备用 HTTP API**：[invokeAPI](../../apps/server/internal/reader/connections.go#L322) 明确发送 `stream: false`，收到完整 JSON 后一次回调。

目前缓冲主 provider 的行为能避免失败后将主 provider 的半截答案与备用答案拼接，这是从调用关系得到的推断。若要改成真实流，需要同时定义 fallback 的替换语义：已经显示的旧片段如何撤回、如何区分新 attempt，或者开始输出后是否还允许自动切换。不能只把 `nil` 改成 `delta`。

## 建议的 Reader 模块边界

以下是拟议结构，尚未创建这些产品文件。

| 拟议位置 | 职责 |
| --- | --- |
| `apps/web/src/chat/AssistantPanel.tsx` | 持有对话与请求状态，隔离阅读器主体；接收文档 ID、引用和导航回调。 |
| `apps/web/src/chat/MessageMarkdown.tsx` | 统一渲染历史/生成中回答；封装包的 API、主题、代码块、公式和链接规则。 |
| `apps/web/src/chat/useStreamingText.ts` | 保存已接收原文与当前展示文本，按帧合并更新；需要时自适应补放；提供 flush/reset/dispose。 |
| `apps/web/src/chat/useChatScroll.ts` | 记录是否贴底；上滚后停止跟随；内容高度变化且仍贴底时调整视口。 |
| `packages/ui/src/components/scroll-area.tsx` | 视需要暴露 Base UI Viewport 的 ref/props，继续使用现有 primitive。 |

关键数据应分开：服务端原文负责保存与最终一致性；显示进度只负责体验；Markdown 为闭合语法而生成的临时补全只存在于渲染层。不能把展示截断文本或补全后的 Markdown 写入数据库。

调度先做按帧合并，避免把每个网络片段都变成独立的 React 更新。采用同款引擎时，优先由引擎内部承担平滑展示，本地 hook 负责接收、轻量合并与生命周期；不要同时叠加 app 的 300ms 缓冲、自写打字队列和引擎平滑。若要自定义节奏，先关闭或统一内置策略。只有大块到达确实造成跳变时，再调整有最大延迟的自适应补放；不要让用户已经收到的长答案继续等待数十秒。中文与 emoji 使用字素边界，不能按 UTF-16 单元任意切割。关闭页面、切换文档、取消时清理动画回调，并用 request/attempt 标识拒收旧回调。尊重 reduced motion。

历史消息可以 memo；块级缓存由成熟 Markdown 引擎承担。不要自己用空行切分后把所有旧块永久冻结：表格头、列表延续和引用式链接都可能受后续输入影响。初期不需要为 Reader 引入复杂消息树或列表虚拟化；先测量较长会话。

## 接入时需要明确的行为

引入 Markdown 会增加链接、图片和富内容入口。最小版本只开放所需的文本、表格、代码和公式，禁止执行生成内容；是否允许 HTML 需要显式配置与回归验证。外部图片默认不自动加载，避免文档内容诱导联网。代码复制、链接操作等控件沿用 Base UI。

桌面目前 [拒绝新窗口和跨源导航](../../apps/desktop/main/index.ts#L206)。若希望点击外链，需实现受控的协议校验与系统浏览器打开流程；普通 `<a target="_blank">` 不能视为已完成桌面适配。Mermaid、HTML 预览、artifact 执行不属于第一阶段需求。

Reader 的 SSE 分帧目前针对自己的 Go 输出：LF 分隔、单行 JSON。迁移渲染包不要求更换该协议。若后续接收外部 SSE，应增加 CRLF、多行 data、UTF-8 分片等覆盖，或采用专门解析器。保留缺失 done 时的错误，避免将异常断流当作保存成功。

## 推荐实施顺序与验收

**阶段一：渲染验证。** 用固定中文论文片段回放：标题、嵌套列表、窄表格、代码围栏、行内/块级公式、引用式链接、未闭合语法。对照一次性全文与不同分片方式的最终输出。首选试验同款独立引擎，再根据组件依赖与渲染结果决定是否采用上层 UI。约 0.5–1 个工程日做出可比较的验证页，是粗估，尚非承诺。

**阶段二：正式前端接入。** 拆出 AI 面板，统一 Markdown，加入按帧调度和条件贴底，覆盖取消/断线/切书/历史替换。粗估另需 2–4 个工程日；含主题、公式字体、代码高亮按需加载与桌面人工检查。需通过 `pnpm typecheck`、`pnpm test`、`pnpm build`。

**阶段三：端到端增量。** 独立处理图片/Kimi/fallback 的替换协议及备用 API 的真实流式读取。Codex 的更细粒度接入需另做官方协议验证后估时；不把这部分计入前端组件迁移。

建议记录三类指标：请求到首段答案可见的延迟、答案结束后的展示尾延迟、渲染期间 React commit/主线程长任务与内存。增加依赖后比较生产构建的入口和异步 chunk，而不拿 npm 包目录大小代替实际 bundle 增量。

人工验收应确认：生成时可向上阅读且不会被拉回底部；返回底部后恢复跟随；深浅主题与 reduced motion 正常；代码/表格不会撑开 250px 侧栏；取消不会继续补放；切换文档不串消息；最终文本与服务端保存内容一致。项目禁止浏览器自动化视觉验收，使用本地预览或 Electron 由用户检查。

本次只做源码调研和文档整理，没有安装渲染依赖、修改生产代码、调用真实 AI 或运行产品构建。迁移尚未实施，性能与视觉效果尚未验证。

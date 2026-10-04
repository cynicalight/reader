# LobeHub 流式前端：上游源码证据

调研日期：2026-10-05。范围：官方仓库与 npm 官方 registry 元数据的静态分析；没有安装依赖、运行上游脚本、启动应用或做性能实测。本文不将“业界最好”视为已验证事实，也不能证明用户看到的线上实例正在使用这些版本。

## 结论

Reader 可以优先评估 **`@lobehub/streamdown`**，它就是目前 Lobe UI 的流式 Markdown 底层，MIT，只有 React/ReactDOM 19 的 peer 依赖。它与 Vercel 的 `streamdown` 是不同包。直接使用这个底层，可以保留 Reader 的 shadcn/Base UI、Go SSE 和现有视觉设计，不需要整套搬入 LobeHub。[包声明][sd-package] [Lobe UI 接线][ui-stream]

LobeHub 的体验由多层共同形成：传输缓冲、Markdown 展示节奏、未闭合语法修复、完成块复用、流式代码高亮、局部状态订阅、滚动意图管理。只换 Markdown 组件可以补齐格式与部分流畅度；不能改善服务端尚未发出内容时的首字等待。Reader 当前的实际链路与改造范围应以主报告的本地源码调查为准。

## 版本边界

| 对象 | 本次确认版本 | 证据边界 |
| --- | --- | --- |
| `lobehub/lobehub` 默认 `canary` | `08232e8efa324659d67a216b5e51bca5963ae19b` | 本次 shallow clone 的 HEAD |
| app 根 `package.json` | `@lobehub/ui: ^5.50.2`、React `19.2.7`、Zustand `5.0.4` | 版本范围，不能推断具体线上安装值 |
| 受 Git 跟踪的 `apps/desktop/pnpm-lock.yaml` | UI `5.54.0`；其 streamdown 解析为 `1.4.0` | desktop lock，不能声称 web 生产环境一定相同 |
| UI `v5.54.0` | `70405664988b9c42af6afee0795434641fccb48d` | 本文 UI 引用固定此提交 |
| UI 最低范围 `v5.50.2` | `619d2f2a0df53dfa4a67f5cd6867908b94e1b443` | 已核实该版本也使用 `@lobehub/streamdown ^1.3.0` |
| UI HEAD `v5.55.0` | `22514bc455f8ed6a20d1c7d3df61c73d6540f6ab` | 与 5.54.0 的 Markdown、useMarkdown、Highlighter 目录无差异 |
| `@lobehub/streamdown` npm latest | `1.4.0`；`gitHead=09d1083fb30f3ab4f75938fefe605a0adb95a52a` | npm registry 与 Git HEAD 一致，本文固定此版本分析 |

来源：[app package][app-package]、[desktop lock][app-lock]、[UI v5.50.2 package](https://github.com/lobehub/lobe-ui/blob/619d2f2a0df53dfa4a67f5cd6867908b94e1b443/package.json)、[streamdown package][sd-package]。本地只读源码位于 `/tmp/lobehub-streaming-research-20261005`、`/tmp/lobehub-ui-streaming-research-20261005`、`/tmp/lobehub-streamdown-research-20261005`。

## 一条已追踪的客户端调用链

下列是 client LLM transport 路径；LobeHub 还有其他 agent transport，不能将这一条路径概括成所有云端/桌面执行方式。

```text
chatService.getChatCompletion
  → fetchSSE(POST, signal, headers)
  → fetchEventSource → getBytes → getLines → getMessages
  → onmessage(JSON.parse(ev.data), switch ev.event)
  → 传输层缓冲 / smooth / none
  → ClientLLMTransport.onMessageHandle
  → StreamingHandler.handleChunk → handleTextChunk
  → onContentUpdate → internal_dispatchMessage
  → Zustand 消息状态 → Conversation 的逐 block selector
  → MessageContent → MarkdownMessage → @lobehub/ui Markdown
  → animated 流式分支：@lobehub/streamdown
  → 静态分支：react-markdown
```

`fetchEventSource` 是基于 Azure fetch-event-source 修改的 fetch/ReadableStream 解析器，支持 POST 与 AbortSignal，不是只能 GET 的原生 EventSource。不要依据其保留的重试注释认为它会自动重连：本次源码 catch 调 onerror 后 resolve，没有完整重试循环。[传输解析器][app-eventsource]

`fetchSSE` 区分 text、reasoning、tool_calls、usage 等事件。`none` 下 text 立即回调；`smooth` 下进入字符队列并由 requestAnimationFrame 按积压调整速度；其他模式（含默认 fadeIn）使用 **300ms 文本缓冲**。结束时停动画、flush 缓冲与队列，再调 onFinish。默认 transitionMode 是 fadeIn；provider 配置、用户配置及请求配置按序合并。因而“它每个 token 都 setState”不符合这个客户端默认路径。[fetchSSE][app-fetch] [配置合并][app-service] [默认配置][app-settings]

`StreamingHandler` 累积 output，再以完整 content 通知更新。transport 将其变成 updateMessage 操作；全局消息 store 应用 reducer、构造 display messages。UI 的 MessageContent 直接订阅指定 block 的 content/hasTools，并以 memo 包裹，避免长内容经过多层 props 传播。这个 app 状态架构较复杂，不宜为了一个 Reader 对话面板复制整套 agent store。[handler][app-handler] [transport][app-transport] [store][app-store] [message component][app-message]

## Markdown 和动画的核心

app 的 `useChatMarkdown` 仅在 enableStream、用户 fadeIn 配置、isGenerating 都成立时 animated；UI 的 Markdown 仅在 enableStream 与 delayedAnimated 都成立时使用 StreamdownRender，其余走 react-markdown。animated 从 true 到 false 有 1 秒延迟，用于收尾。流式与静态分支应使用一致 plugins、components、CSS，否则结束时容易发生排版变化。[app hook][app-markdown-hook] [UI Markdown][ui-markdown] [收尾延迟][ui-delay]

`@lobehub/streamdown` 的内部步骤：

1. `useSmoothStreamContent` 将输入内容与展示内容分离，估计输入速度，按积压加快排出。balanced 基础提交间隔 48ms，realtime 32ms，silky 56ms；长尾块会扩大间隔，上限 96ms。requestAnimationFrame 负责时间推进，React 不必按每个字符提交。当前代码还会对未闭合 html fence 绕过平滑，以支持上层预览及时更新。[调度源码][sd-smooth]
2. `createBlockLexer` 用 remend 修复未完成尾部，再用 marked lexer 分块。已确认安全边界的前缀被冻结，只重新修复/分词尚可变化的尾部。列表和缩进代码等不能简单按空行冻结。[lexer][sd-lexer]
3. `StreamdownBlock` memo，稳定 plugins/components；`CachedMarkdown` 复用 unified processor，用 remark-parse → remark plugins → remark-rehype → rehype plugins → JSX 渲染。完成块减少重复工作，长未闭合段落/列表/代码块仍随尾部增长增加开销。不能把它描述成对所有输入恒定成本。[主组件][sd-main] [parser缓存][sd-cache]
4. rehype 动画为新增可见字符记录出现时间，维持稳定 key 与单调显示，避免块状态变化时整段重播；CSS 淡入为 180ms。表层可以逐字符淡入，底层 React 仍按较低频率提交。[主组件][sd-main] [动画插件][sd-animation] [CSS][sd-styles]

这套包是无外观样式的渲染引擎，仍需自己提供排版、代码块、表格横向滚动、链接行为、图片政策等。它会注入动画 CSS，不能将官方“无 stylesheet”概括成“完全不生成 style 标签”。[主组件][sd-main] [CSS][sd-styles]

## 未完成语法、代码、公式

remend 负责尾部不完整 Markdown 的补全处理，应用只应将修复结果用于显示，持久化与复制原文仍以收到的原始内容为准。代码 fence 尚未闭合时继续作为尾部处理。具体不完整表格、强调、链接边界仍应拿 Reader 常见输出做回放测试，不能把修复器描述成完整语法保证。[lexer][sd-lexer]

LaTeX guard 在结尾公式无法渲染时保留上一次有效内容，降低原始公式或错误闪烁。它是呈现策略，不会提供模型输出的正确性保证；没有先前有效帧时仍返回当前内容。底层不默认添加 remark-math 与 KaTeX 渲染插件，调用方需要提供。UI 另有 KaTeX 0.18 适配实现，说明公式 HTML、字体与 CSS 版本也必须匹配。[guard][sd-main] [包使用方式][sd-readme] [UI KaTeX][ui-katex]

代码高亮由 **Lobe UI 层** 的 `useStreamHighlight` 和 `@shikijs/stream` 提供。它在 append 时仅 enqueue 新后缀，非 append 时 clear；输出 stable/unstable tokens，尽量保留未变行的引用。StreamRenderer 的 TokenSpan/Line 也做 memo，token fade 记录字符出现时间，避免高亮器重新拆分 token 导致已显示文字重新淡入。单装 `@lobehub/streamdown` 不会自动得到这套高亮及复制按钮。[高亮 hook][ui-highlight] [renderer][ui-highlight-render] [token fade][ui-token-fade]

## 滚动策略

LobeHub 使用 virtua VList，并有自动滚动开关、回到底部按钮、滚动位置恢复与用户输入意图追踪。AutoScroll 只在 atBottom && isGenerating && !isScrolling 时滚到底部，采用非 smooth 的更新，避免内容每次变化都打断用户阅读。当前 atBottom 阈值为 300px；这是此应用参数，Reader 狭窄侧栏不应直接照搬。[VirtualizedList][app-list] [AutoScroll][app-autoscroll] [阈值][app-scroll-const]

发送新消息还涉及占位高度、将新一轮用户消息置顶、ResizeObserver 布局反馈，以及用户向上滚动时取消固定。Reader 初期可以借鉴“只有用户仍贴底才跟随”，无需一开始迁移虚拟化与全部会话置顶逻辑。[conversation scroll][app-scroll]

## 直接复用与限制

| 对象 | 判断 | 原因 |
| --- | --- | --- |
| `@lobehub/streamdown@1.4.0` | 优先候选 | MIT、React19、ESM、无 AntD peer，可注入现有 components/plugins/CSS |
| `@lobehub/ui` 整体 Markdown | 可验证但不宜默认引入 | MIT；peer 包含 AntD6、motion、Lobe icons/emoji，增加 Reader 外观/主题依赖；实际 tree shaking 与包体须构建测量 |
| UI 高亮 hook/renderer | 后续选择性研究 | 也是 MIT，但依赖 Shiki、主题、styles、内部 helpers，不能只拷一个文件就工作 |
| app `@lobechat/fetch-sse` | 不作为直接 npm 方案 | private workspace 包，依赖 app model-runtime/types/const；协议也与 Reader 不同 |
| app Conversation/Zustand/scroll 文件 | 借鉴机制，不整套搬入 | 绑定 agent runtime/context/operation；app 许可证还有商业衍生分发条件 |

许可证以各自 [app LICENSE][app-license]、[UI LICENSE][ui-license]、[streamdown LICENSE][sd-license] 为准。这里仅报告官方文本：app 使用 LobeHub Community License，基于 Apache 2.0 加条件；UI 与 streamdown 使用 MIT。不能把主 app 许可证套到独立 MIT 包，也不能把主 app 当作无附加条件 Apache 包直接复制。

兼容与风险事项：

- `@lobehub/streamdown` 要求 React/ReactDOM ^19、Node >=22；Vite 能消费 ESM，包没有 Next 专属运行时依赖。Reader 本地 Node/打包配置需要落地时检查，不能只看 React 版本。[package][sd-package]
- 官方明确：顶层块独立解析，**跨块脚注、reference-style links/images 的定义不能自动互相解析**。Reader 读书问答若依赖引用，应定义自己的引用组件，或在完成后以统一插件整篇静态渲染，并测试切换位移。[官方限制][sd-readme]
- 当前 CSS reduced-motion 规则仅处理 `.stream-block`，未覆盖 `.stream-char`；调度 hook 没有系统偏好分支。Reader 应在 adapter 根据 reduced motion 关闭平滑/动画或选择静态分支，不能声称直接引入即满足现有要求。[CSS][sd-styles] [调度][sd-smooth]
- 流式修复、LaTeX guard 都不等于 HTML 清洗。底层默认 raw HTML 作为文本或 skipHtml 删除，默认 URL transform 沿用 react-markdown；若引入 rehypeRaw、自定义 component 或 HTML preview，需要单独维护安全边界。UI 的 allowHtml 分支明确用 rehypeRaw 后接 rehypeSanitize。Reader 初期应不启用 app 的 HTML artifact preview。[CachedMarkdown][sd-cache] [UI HTML 插件顺序][ui-rehype]
- 不要同时复制 app 的300ms缓冲、旧smooth队列，又默认开启新引擎的延迟展示，而不测总延迟。调度层应有明确职责，传输只聚合必要状态提交，展示引擎处理视觉节奏。[传输][app-fetch] [展示][sd-smooth]
- 停止、错误、fallback、切会话、卸载、后台标签节流、emoji组合字符、长代码、最终权威答案替换都需回放验证；本次未运行这些验收。

建议最小试验：独立 `AssistantMarkdown` 适配层使用同款 `@lobehub/streamdown`；保留 Reader 的 Go SSE、现有控件与样式；先验证标题/列表/代码/表格/数学和停止/完成收尾；再测长文本提交耗时与贴底行为，按证据决定是否增加 Shiki 流式高亮。这个顺序能隔离渲染收益与服务端首字延迟。

[app-package]: https://github.com/lobehub/lobehub/blob/08232e8efa324659d67a216b5e51bca5963ae19b/package.json
[app-lock]: https://github.com/lobehub/lobehub/blob/08232e8efa324659d67a216b5e51bca5963ae19b/apps/desktop/pnpm-lock.yaml#L10025-L10040
[app-fetch]: https://github.com/lobehub/lobehub/blob/08232e8efa324659d67a216b5e51bca5963ae19b/packages/fetch-sse/src/fetchSSE.ts
[app-eventsource]: https://github.com/lobehub/lobehub/blob/08232e8efa324659d67a216b5e51bca5963ae19b/packages/utils/src/client/fetchEventSource/index.ts
[app-service]: https://github.com/lobehub/lobehub/blob/08232e8efa324659d67a216b5e51bca5963ae19b/src/services/chat/index.ts#L399-L430
[app-settings]: https://github.com/lobehub/lobehub/blob/08232e8efa324659d67a216b5e51bca5963ae19b/packages/const/src/settings/common.ts
[app-handler]: https://github.com/lobehub/lobehub/blob/08232e8efa324659d67a216b5e51bca5963ae19b/src/store/chat/agents/StreamingHandler.ts#L219-L238
[app-transport]: https://github.com/lobehub/lobehub/blob/08232e8efa324659d67a216b5e51bca5963ae19b/src/store/chat/agents/transports/ClientLLMTransport.ts#L205-L320
[app-store]: https://github.com/lobehub/lobehub/blob/08232e8efa324659d67a216b5e51bca5963ae19b/src/store/chat/slices/message/actions/internals.ts#L42-L81
[app-message]: https://github.com/lobehub/lobehub/blob/08232e8efa324659d67a216b5e51bca5963ae19b/src/features/Conversation/Messages/AssistantGroup/components/MessageContent.tsx
[app-markdown-hook]: https://github.com/lobehub/lobehub/blob/08232e8efa324659d67a216b5e51bca5963ae19b/src/features/Conversation/Messages/useChatMarkdown.tsx
[app-list]: https://github.com/lobehub/lobehub/blob/08232e8efa324659d67a216b5e51bca5963ae19b/src/features/Conversation/ChatList/components/VirtualizedList.tsx
[app-autoscroll]: https://github.com/lobehub/lobehub/blob/08232e8efa324659d67a216b5e51bca5963ae19b/src/features/Conversation/ChatList/components/AutoScroll/index.tsx
[app-scroll-const]: https://github.com/lobehub/lobehub/blob/08232e8efa324659d67a216b5e51bca5963ae19b/src/features/Conversation/ChatList/components/AutoScroll/const.ts
[app-scroll]: https://github.com/lobehub/lobehub/blob/08232e8efa324659d67a216b5e51bca5963ae19b/src/features/Conversation/ChatList/hooks/useConversationScroll.ts
[app-license]: https://github.com/lobehub/lobehub/blob/08232e8efa324659d67a216b5e51bca5963ae19b/LICENSE
[ui-stream]: https://github.com/lobehub/lobe-ui/blob/70405664988b9c42af6afee0795434641fccb48d/src/Markdown/SyntaxMarkdown/StreamdownRender.tsx
[ui-markdown]: https://github.com/lobehub/lobe-ui/blob/70405664988b9c42af6afee0795434641fccb48d/src/Markdown/Markdown.tsx
[ui-delay]: https://github.com/lobehub/lobe-ui/blob/70405664988b9c42af6afee0795434641fccb48d/src/Markdown/components/useDelayedAnimated.ts
[ui-katex]: https://github.com/lobehub/lobe-ui/blob/70405664988b9c42af6afee0795434641fccb48d/src/Markdown/plugins/rehypeKatex.ts
[ui-highlight]: https://github.com/lobehub/lobe-ui/blob/70405664988b9c42af6afee0795434641fccb48d/src/hooks/useStreamHighlight.ts
[ui-highlight-render]: https://github.com/lobehub/lobe-ui/blob/70405664988b9c42af6afee0795434641fccb48d/src/Highlighter/SyntaxHighlighter/StreamRenderer.tsx
[ui-token-fade]: https://github.com/lobehub/lobe-ui/blob/70405664988b9c42af6afee0795434641fccb48d/src/Highlighter/SyntaxHighlighter/tokenFade.ts
[ui-rehype]: https://github.com/lobehub/lobe-ui/blob/70405664988b9c42af6afee0795434641fccb48d/src/hooks/useMarkdown/useMarkdownRehypePlugins.ts
[ui-license]: https://github.com/lobehub/lobe-ui/blob/70405664988b9c42af6afee0795434641fccb48d/LICENSE
[sd-package]: https://github.com/lobehub/streamdown/blob/09d1083fb30f3ab4f75938fefe605a0adb95a52a/package.json
[sd-readme]: https://github.com/lobehub/streamdown/blob/09d1083fb30f3ab4f75938fefe605a0adb95a52a/README.md
[sd-main]: https://github.com/lobehub/streamdown/blob/09d1083fb30f3ab4f75938fefe605a0adb95a52a/src/Streamdown.tsx
[sd-smooth]: https://github.com/lobehub/streamdown/blob/09d1083fb30f3ab4f75938fefe605a0adb95a52a/src/useSmoothStreamContent.ts
[sd-lexer]: https://github.com/lobehub/streamdown/blob/09d1083fb30f3ab4f75938fefe605a0adb95a52a/src/blockLexer.ts
[sd-cache]: https://github.com/lobehub/streamdown/blob/09d1083fb30f3ab4f75938fefe605a0adb95a52a/src/CachedMarkdown.tsx
[sd-animation]: https://github.com/lobehub/streamdown/blob/09d1083fb30f3ab4f75938fefe605a0adb95a52a/src/rehypeStreamAnimated.ts
[sd-styles]: https://github.com/lobehub/streamdown/blob/09d1083fb30f3ab4f75938fefe605a0adb95a52a/src/styles.tsx
[sd-license]: https://github.com/lobehub/streamdown/blob/09d1083fb30f3ab4f75938fefe605a0adb95a52a/LICENSE

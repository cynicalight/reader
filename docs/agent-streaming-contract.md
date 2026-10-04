# Agent 流式输出：前后端对接约定

## 本轮联调冻结项 · 2026-10-05

本节是已确认的 LobeHub 前端迁移与后端统一适配工作的固定边界。两方分别执行 [前端任务](./frontend-streaming-migration.md) 和 [后端任务](./backend-streaming-adapter.md)，内部实现可自行决定；修改下表必须先由协调会话确认并同步两方，不能单方改变字段、追加/替换语义或完成条件。

| 项目 | 本轮固定约定 |
| --- | --- |
| 接口与认证 | `POST /api/documents/{documentId}/chat`；Reader 会话 Bearer token；JSON 请求。不是 Agent API Key。 |
| 必填请求字段 | `provider: "codex" \| "claude" \| "kimi"`、`prompt: string`、`context: string`；context 可为空。 |
| 可选请求字段 | `references: SourceReference[]`、`attachments: string[]`，省略等价于空数组；附件是当前文档块 ID。不新增 connectionId 或客户端模型/认证字段。 |
| 事件与 JSON data | `status {status:"reading"\|"reading-image"}`、`delta {text:string}`、`fallback {message:string}`、`error {error:string}`、`done {ok:true}`。仍使用独立 SSE event 行，不另包 type/payload 外壳。 |
| 正文 | delta 仅为新增原始文本，保留空格/换行；按到达顺序追加。不是累计全文、HTML 或 AST，不携带推理/工具/日志。 |
| 成功终态 | 适配器确认成功且完整助手消息保存成功后，仅一次 done；最终全文从 messages 读取并替换临时回答，不再次追加。 |
| 失败终态 | 流开始前非 200 JSON error；开始后仅一次 error，不再 done；终态后无正文。EOF 本身不代表成功。 |
| 取消/断流 | AbortSignal 断开请求并停止上游；不承诺取消事件。保存竞态/终态丢失由 messages 核对；不自动重新 POST。 |
| 备用策略 | 最多从选定 Agent 切换到已配置且验证通过的对应备用 API；只允许首个正文之前切换，先 fallback 再 delta。已显示正文、主动取消、总超时均不自动切换；不能自动轮询另两种 Agent。 |
| 请求限制 | 维持当前 prompt 16,000 / context 64,000 UTF-8 字节、最多 4 个附件、回答 1MiB、3 分钟总超时及交互请求并发限制。 |
| 暂不支持 | wire 版本字段/协商、序号、messageId、usage、断点续传、正文替换事件。不得依赖未实现字段。 |

正常序列为 `status → delta+ → done`；备用序列为 `status → fallback → delta+ → done`；失败为 `status → [fallback] → delta* → error`，也可能在建立流前直接 HTTP 失败。SSE 注释可忽略；网络读取分片没有业务含义。主动取消或断网可能没有终态。

**实现状态边界：** 下方正文记录 `2afe113` 已交付行为。迁移目标会将“首段前可用配置内备用”统一到普通文字及图片/Kimi 路径，并把已支持的备用 HTTP API 改为真实流；这两项由后端 B2 交付，不能在交付前视为已实现。事件形状始终不变，前端需兼容单个大 delta。其余冻结项延续当前协议；后端须补足终态后拒绝迟到事件等边界测试。

联调至少共同覆盖成功、首段前备用、首段后失败、主动取消、无 done 断流、保存成功但同步查询失败。前端用相同事件 fixtures 回放，后端用 gated HTTP 测试验证首段在上游结束前送达。两方都不以“HTTP 200”或“已有文字”代替成功终态。

后端负责调用 Agent、过滤协议事件、及时发送回答片段，并在成功结束后保存完整回答。前端负责接收 SSE、维护临时回答及渲染状态。Markdown、公式、代码块的渲染方式、刷新频率、自动滚动及取消后的展示由前端决定。

`2afe113` 的三种 Agent 协议实现已合入 main。本轮统一服务位于 `backend/unified-streaming` / `Reader-streaming-backend`，尚未集成 main。阶段实现及证据见 [后端进度](./implementation/backend-streaming-progress.md)。顶部冻结表保持不变。

## 1. 请求接口

```http
POST /api/documents/{documentId}/chat
Authorization: Bearer <当前 Reader 会话 token>
Content-Type: application/json
```

```ts
import type { SourceReference } from "@reader/core";

type ChatRequest = {
  provider: "codex" | "claude" | "kimi";
  prompt: string;
  context: string;
  references?: SourceReference[];
  attachments?: string[];
};
```

`claude` 对应 Claude Code，`kimi` 对应 Kimi Code。`references` 用于保存来源引用；EPUB 使用自身的 `href`、`locator` 等位置字段，PDF 使用页码，类型见 [reader-core](../packages/reader-core/src/index.ts)。

`attachments` 是当前文档已有图片块的 ID，例如 `p1-b1`，最多 4 项。后端读取并发送图片；前端无需在此请求中上传 base64。`prompt` 必须非空，最多 16,000 UTF-8 字节；`context` 最多 64,000 UTF-8 字节。没有摘录时传空字符串。

```json
{
  "provider": "codex",
  "prompt": "请解释这段内容",
  "context": "当前摘录……",
  "references": [],
  "attachments": []
}
```

通过 `fetch` 发起 POST 并读取 `response.body`。原生 `EventSource` 不适合此接口，因为需要 POST 请求体和 Authorization 请求头。复用现有 `configureAPI(token)` 与会话初始化，不另建 Agent 登录流程。

## 2. 响应与事件数据

成功建立输出流后，HTTP 状态为 `200`，响应头为：

```http
Content-Type: text/event-stream
Cache-Control: no-cache
X-Accel-Buffering: no
```

每个 SSE 事件由 `event:` 行、`data:` 行及一个空行组成。`data` 是 JSON；正文中的换行在 JSON 中转义。以下类型描述每个事件解析后的结构，**不是另外包在 HTTP 响应中的 JSON 对象**。

```ts
type ChatStreamEvent =
  | { event: "status"; data: { status: "reading" | "reading-image" } }
  | { event: "delta"; data: { text: string } }
  | { event: "fallback"; data: { message: string } }
  | { event: "error"; data: { error: string } }
  | { event: "done"; data: { ok: true } };
```

| 事件       | 含义                                                        | 前端处理约定                                           |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| `status`   | 后端已开始处理。不是进度百分比，也不是回答正文。            | 可以进入等待回答状态。                                 |
| `delta`    | 回答的新增文本片段。                                        | 按到达顺序追加到本次请求的临时回答，不能替换已有全文。 |
| `fallback` | 主 Agent 未输出文字便失败，已切换到通过能力测试的备用 API。 | 可以显示提示；不要将提示写入回答正文。                 |
| `error`    | 本次请求失败。流建立后 HTTP 仍然为 200。                    | 结束生成状态，显示错误；不要继续等待 `done`。          |
| `done`     | 完整回答已经成功保存到后端数据库。                          | 将本次请求标记完成，读取消息列表与已保存记录对齐。     |

`delta.text` 是原始回答文本，可能包含 Markdown。它不是累计全文，不保证是一个 token、一个字、一句话或完整的 Markdown 节点。后台不会把推理内容、工具输出、CLI 日志或重复的最终全文放入 `delta`。目前没有 message ID、序号、usage、心跳或断点续传事件。

一次成功响应示例：

```text
event: status
data: {"status":"reading"}

event: delta
data: {"text":"这段内容"}

event: delta
data: {"text":"说明了 HTTP 流式传输。\n\n"}

event: delta
data: {"text":"**关键点**是逐段接收数据。"}

event: done
data: {"ok":true}

```

后端在每个事件后调用 `Flush()`。网络和运行时仍可能合并多个事件，或把一个事件切成多个读取块。因此，一次 `reader.read()` 不等于一个事件，也不等于一个文本片段。

## 3. 完成、失败、取消与保存

正常顺序是 `status → delta… → done → 连接结束`。发生自动切换时为 `status → fallback → delta… → done`。失败可能发生在首个 `delta` 前，也可能发生在若干片段后；`error` 后没有 `done`。

用户消息在开始生成前保存。生成中的助手文字只存在于临时输出中；后端确认 Agent 成功完成后，才保存一条完整的助手消息，再发送 `done`。前端不要为每个 `delta` 创建一条持久化消息。

收到 `done` 后，可调用 `GET /api/documents/{documentId}/messages`，也就是现有 `api.messages(documentId)`。该接口返回的助手 `content` 是完整回答。不要再将它追加到临时回答，否则会重复显示。前端决定如何用已保存记录替换临时消息。

流开始前的校验、登录或并发错误使用非 200 HTTP 响应和 `{"error":"说明"}`。常见状态为 `400`、`401`、`404`、`409`；`409` 表示已有交互式 AI 请求运行。应先检查 `response.ok`，再选择 JSON 错误处理或 SSE 读取。

流开始后的失败使用 `event: error`。一旦已有文字送达，后端不会自动切换到另一个模型追加第二份回答。不完整的助手回答不会按成功结果保存。当前端没有收到 `done` 就遇到 EOF、网络错误或解析错误，应视为“完成状态未确认”。如果后端恰好已保存、但终止事件在网络中丢失，数据库仍可能有完整回答；应重新读取消息列表确认，不要断言一定没有保存。

取消使用本次 `fetch` 的 `AbortController.abort()`。连接断开会传播到后端 Context，终止 CLI 并清理临时工作目录。主动取消不保证还能收到终止事件。用户消息不会因此回滚；若取消与保存同时发生，仍以消息列表为准。前端决定是否保留临时文字供查看，但不能将其显示成已保存的成功回答。

后端每次生成的超时为 3 分钟，回答上限为 1 MiB UTF-8 字节。Agent 启动或思考期间可能只有 `status`，暂时没有 `delta`。当前没有自动恢复流的接口；重新 POST 是新的请求，会新增用户消息，因此不要对断流自动重放请求。

## 4. 各 Agent 的后端适配

| Provider | 后端获取的增量事件                                                                                 | 对前端的统一输出 |
| -------- | -------------------------------------------------------------------------------------------------- | ---------------- |
| `codex`  | `codex app-server` 的 `item/agentMessage/delta`                                                    | `delta {text}`   |
| `claude` | Claude Code `stream-json` 的 `content_block_delta / text_delta`，启用 `--include-partial-messages` | `delta {text}`   |
| `kimi`   | Kimi Code ACP 的 `session/update / agent_message_chunk`                                            | `delta {text}`   |

前端无需解析上述 CLI 协议，也无需为不同 Agent 编写 SSE 分支。纯文字及带图片请求都使用相同事件结构。Codex 的完整消息事件仅用于补齐未发送后缀与一致性校验，不会重复发送已有内容。

本轮 `backend/unified-streaming` 已将 `text-api` / `image-api` 接到 OpenAI Chat Completions SSE：发送 `stream:true`，只消费 choice 0 的 `delta.content`，要求 `finish_reason:stop` 与 `[DONE]`。不支持 SSE 的上游明确报错，不自动再发非流请求；尚未声明其他 API 协议兼容性。正文及图片输入共用相同适配器与输出。前端仍须兼容单个大 delta。

本轮普通 Codex/Claude 文字、Kimi 和图片均使用统一备用策略：首段前仅切到已配置且通过所需能力验证的对应备用 API；先 fallback 后 delta。首段后失败、客户端取消、总超时均不切换。后台任务的失败 attempt 单独丢弃，不混入备用正文。配置在请求开始时建立快照，不在生成中途读取新 key 或模型。

当前 `/api/ai/config` 仍是无密钥的配置/验证状态读取入口；只返回 hasKey，保留文字和图片验证结果。CLI 登录状态由现有 providers 接口提供，不把安装、登录、文字能力、图片能力混为一个状态。本轮没有新增连接目录或 connectionId。

错误和成功终态由同一 SSE writer 门控。写入/Flush 失败取消上游；Codex 尝试 turn/interrupt，Kimi 发送 session/cancel 并等待原 prompt response，400ms watchdog 强制回收。Claude 先 SIGINT 再有界强制退出。取消开始后拒绝正文；Claude result 后忽略迟到文字且仍要求进程正常退出。Kimi 校验 sessionId 和协商版本。

## 5. 前端工作范围

已有接入点是 [packages/api-client/src/index.ts](../packages/api-client/src/index.ts) 的 `chat()` 和 [apps/web/src/Workspace.tsx](../apps/web/src/Workspace.tsx) 的发送流程。当前 SDK 使用 `onDelta(text)` 转发片段，已有 `AbortSignal`、`onFallback`、错误处理与完成检查；当前界面通过 `setStream(previous => previous + text)` 追加内容。`status` 尚未通过 SDK 回调暴露。前端同事可在此基础上决定是否调整接口和渲染实现。

需要前端确认以下行为：

1. 使用流式 UTF-8 解码和跨读取块缓冲；正确处理一个读取块含多个事件、一个事件跨多个读取块，以及中文字符被切开的情况。
2. 在请求结束前持续显示 `delta.text`。如为性能合并刷新，应保持文字顺序，不等待完整响应才渲染。
3. Markdown、代码围栏、公式等可能暂时不完整，渲染策略由前端决定。回答内容应按不可信文本处理。
4. `done` 后对齐已保存消息；`error`、主动取消、异常 EOF 都能结束生成状态，并与成功状态区分。
5. 切换文档或开始新请求后，旧请求的回调不再修改新会话的显示。
6. 长回答的自动滚动、用户上翻后的滚动策略，以及每帧批量刷新由前端决定。

这里没有要求前端增加模拟打字动画。后端提供的是 Agent 实际到达的片段，前端按需要组织渲染。

## 6. 联调与验证

后端自动测试覆盖三种 Agent 的纯文字和图片 HTTP/SSE 请求。测试中的 Agent 发出第一段后会暂停，只有 HTTP 客户端收到并确认该段，才继续输出和完成，因此能检测后端缓冲和遗漏 `Flush()`。另有重复完成事件、跨会话事件过滤、RPC 操作拒绝、失败、取消、临时目录清理及不完整回答不落库的测试。

```sh
cd apps/server
go test ./internal/reader -run 'TestAgent|TestCodexProtocolBoundaries|TestChatStreamsOverHTTP|TestChatPartialFailure' -count=1
```

真实调用可选以下测试，只发送内置原创提示，并使用 CLI 自身登录：

```sh
READER_TEST_STREAM_PROVIDER=codex go test ./internal/reader -run '^TestLiveAgentStreaming$' -count=1 -v
READER_TEST_STREAM_PROVIDER=claude go test ./internal/reader -run '^TestLiveAgentStreaming$' -count=1 -v
READER_TEST_STREAM_PROVIDER=kimi go test ./internal/reader -run '^TestLiveAgentStreaming$' -count=1 -v
```

本次本机实测：Codex CLI 0.160.0 返回 193 个片段，首段约 6.1 秒、完成约 10.6 秒；Kimi 返回 214 个片段，首段约 6.2 秒、完成约 11.8 秒。这些是一次请求的记录，不是延迟承诺。Codex 另通过合成图片识别测试。Claude Code 2.1.220 当前未登录，已验证模拟协议，真实生成待具备登录环境后验证。

人工联调可在合并后的仓库运行 `pnpm dev`，打开终端输出的带会话 token 的 Reader 地址。使用已登录的 Agent，分别测试长段落、代码块、公式和图片问题，确认首段提前显示、没有最终全文重复、取消后不再追加、失败后能重新发送。不要求用浏览器自动化验收；界面效果由前端同事人工确认。

官方协议参考：[Codex App Server](https://learn.chatgpt.com/docs/app-server)、[Claude Code 流式响应](https://code.claude.com/docs/en/headless#stream-responses)。

## 本轮类型与回放证据

[OpenAPI](./openapi.yaml) 的 `ChatStreamEvent` 描述解码后的五事件联合类型；`text/event-stream` 实际仍是 SSE 文本，没有 JSON envelope。生成类型位于 `packages/api-client/src/schema.d.ts`。可共用 [v1 fixtures](./fixtures/agent-streaming-v1.json)，覆盖成功、备用、部分失败和无终态断流。`TestFrozenStreamFixtures` 通过实际 writer 回放，检查事件形状、正文追加及终态后拒绝事件。

本轮真实 CLI 的版本、文字/合成图片首段与完成时间、取消结果及未验证项，以 [后端进度](./implementation/backend-streaming-progress.md) 为准。上文原有历史实测仅描述先前基线。Claude 未登录、商业备用 API 实测、合并前端后的真实人工验收仍待完成；模拟协议和 HTTP gated 测试不替代这些验收。

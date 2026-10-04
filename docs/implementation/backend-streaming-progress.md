# 后端流式迁移进度

工作树：`/Users/bu44er/Developer/Projects/Reader-streaming-backend`。分支：`backend/unified-streaming`。共同基线：`85f21938f13914c48131a455cb586d4e964b90c9`。仅修改本工作树拥有的 Go、契约、OpenAPI 和生成类型。未合并、推送或部署。

代码提交：`f7d4f28`（统一 Adapter/GenerationService/聊天生命周期）、`2f7f820`（真流/备用/生命周期验证、OpenAPI 和 fixtures）。2026-10-05 交付前再次核对 main，仍为 `2afe113e8f02593da79b3ad5fbc5c8f1c721a639`。未复制主工作区的未提交产品修改。集成前协调会话需再次检查 main。

## 完成边界

B1、B2、B3 的实现及自动验证完成。B4 内部连接/认证抽象、OpenAPI、生成类型和回放 fixtures 已完成；Codex/Kimi 真实适配器文字、合成图片和取消已验证。Claude 未登录、商业备用 API 厂商兼容性，以及前端合并后的真实人工联调仍待验证，因此不宣称 B4 联合验收或整体迁移完成。没有接口变更阻塞。

## 实现决定

`GenerationService` 在每请求开始时解析连接、模型、认证及验证能力快照。内部 registry 以现有 provider/text-api/image-api 标识绑定 adapter，不增加对外 connectionId。`Adapter.Stream` 串行输出内部事件及权威正文；service 校验累计正文与成功终态。CLI adapter 复用三种已合入协议。后台生成使用同一 adapter，失败 attempt 的容器独立，不走 HTTP。

普通文字、Kimi 和图片聊天合并到 `chatDocument → streamChat → GenerationService`。保留 Codex/Claude 普通文字无需事先能力探测的兼容入口；图片和 Kimi 仍要求验证。每条用户消息保存一次，助手只在成功且累计一致后保存；保存成功再发 done。`context` 按冻结契约必填、可为空。历史摘录保持传递。

`chatStreamWriter` 是唯一 SSE writer。写入/Flush 失败取消上游，终态后禁止发送。写阻塞受请求截止时间及取消控制。保存成功后 done 丢失不会回滚消息。日志仅记录随机内部关联 ID、首段/Flush/完成耗时和脱敏错误类别，不输出 key、token、正文或上游原始错误。

API 明确只支持 OpenAI Chat Completions SSE，发送 `stream:true,n:1`、选择 choice 0、原样转发 content。必须收到 `finish_reason:stop` 和 `[DONE]`；EOF、HTTP 200、截断及拒绝均不算成功。API 不支持 SSE 时明确报错，不自动再发非流请求；本轮没有已声明 non-incremental 连接。不跟随重定向，不转发上游错误正文。单回答 1 MiB，单帧上限 8 MiB 兼顾 JSON 转义。

文字和图片统一备用：首段前最多切到已配置且通过所需能力测试的 text-api/image-api，不轮询其他 Agent。首段后、主动取消、总超时不切换。后台没有可见正文时可丢弃失败 attempt 后走对应备用。设置改变使验证失效；读取设置继续只返回 hasKey。

Codex 尝试 turn/interrupt；Kimi 发送无 ID 的 session/cancel 并继续读取原 prompt response，等待期间拦截排队正文。400ms watchdog 关闭管道并杀进程，退出时等待清理；Claude 先 SIGINT，再有界强制回收。补 Kimi sessionId/协商版本过滤、Claude result 后迟到事件和非零退出、正文/结果一致性校验。当前基线没有文档删除 HTTP 接口；保存前再次检查文档且有数据库外键保护，不宣称新增删除动作的主动取消联调。

## 测试证据

最终代码检查（2026-10-05）：

| 检查                                    | 结果                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm typecheck`                        | 通过                                                                     |
| `pnpm test`                             | Go 通过（20.556s）；Vitest 16 文件、46 项通过                            |
| `pnpm build`                            | 通过；保留原有 Vite >500kB chunk 提示                                    |
| `cd apps/server && go test -race ./...` | 通过（35.858s）                                                          |
| `git diff --check`                      | 通过                                                                     |
| 冻结段/所有权                           | 契约顶部逐字与基线相同；pnpm-lock.yaml 无变化；未编辑 UI 或 SDK 消费实现 |

自动测试包含三种 CLI 的文字/图片 gated HTTP、部分失败不落库、首段前备用、首段后不备用、取消和强制回收、迟到事件、重复终态、身份过滤、RPC 拒绝、无成功终态、保存失败、HTTP 断开释放锁及临时目录、done 丢失后消息仍可查询。

六组 Agent→备用 API 的文字/图片 gated HTTP 测试要求客户端收到首段后才放行上游完成。另覆盖一字节网络分片、CRLF/多行 data、UTF-8、choice 过滤、拒绝/截断/上游错误、缺失 stop/DONE、转义后超过 2 MiB 的合法帧、1 MiB 正文限制、超大帧、重定向拒绝、emit 失败关闭 HTTP body、禁止非流重试。后台可重试与交互可见正文策略分开测试。

真实适配器仅使用原创提示与随机合成色块图，无用户书籍：

| CLI                 | 输入           | 片段   | 首段    | 完成    | 首段取消后返回              |
| ------------------- | -------------- | ------ | ------- | ------- | --------------------------- |
| Codex 0.160.0       | 文字           | 42     | 11.873s | 12.757s | 7.4ms                       |
| Codex 0.160.0       | 合成图片       | 122    | 5.668s  | 9.381s  | 同独立取消用例              |
| Kimi 2.0.2          | 文字           | 131    | 5.383s  | 8.855s  | 45.7ms                      |
| Kimi 2.0.2          | 合成图片       | 131    | 7.783s  | 11.327s | 同独立取消用例              |
| Claude Code 2.1.220 | 文字/图片/取消 | 待验证 | —       | —       | auth status: loggedIn=false |

真实结果是本次重构后的单次样本，不是延迟承诺；取消用例检查单段后无后续回调和及时返回，协议消息是否实际发出另由模拟握手测试断言。备用 API 用本机真实 HTTP/SSE 上游测试，未提供或使用商业 API Key，尚未实测厂商端差异。CLI 历史文档里的数据不作为本次证据。

复验命令：

```sh
cd apps/server
READER_TEST_STREAM_PROVIDER=codex go test ./internal/reader -run '^TestLiveGenerationAdapter$' -count=1 -v
READER_TEST_STREAM_PROVIDER=kimi go test ./internal/reader -run '^TestLiveGenerationAdapter$' -count=1 -v
# Claude 登录后，用相同命令并把 provider 换为 claude。
go test ./internal/reader -run 'TestAPIFallbackStreamsOverHTTP|TestAgentCancellationHandshake|TestHTTPDisconnect|TestDoneLoss|TestFrozenStreamFixtures' -count=1
```

## 联调交付

[OpenAPI](../openapi.yaml) 的 `ChatStreamEvent` 是解码后联合类型，线上仍是 event/data 行。生成文件：`packages/api-client/src/schema.d.ts`。共用 [v1 fixtures](../fixtures/agent-streaming-v1.json)（success/fallback/partial-error/missing-terminal），`TestFrozenStreamFixtures` 通过实际 writer 回放；前端可只读消费。契约正文实现状态已更新，冻结项未改。

本机后端预览已运行在 `http://127.0.0.1:65219`，使用独立临时书库及本工作树构建的基线 UI。HTTP 检查 `/`、health 和带认证 documents 返回 200，无认证 documents 返回 401。启动状态和本机会话 token 存在权限 0600 的 `/tmp/reader-streaming-backend-preview.json`，不进 Git。打开方式：读取该文件，将 `url + '/#token=' + token` 作为地址。预览是进程存活期间的本机地址，不是部署或合并前端后的视觉验收。

重新启动可在此工作树运行：

```sh
pnpm build
apps/desktop/bin/reader-server --data "$(mktemp -d /tmp/reader-streaming-preview.XXXXXX)" --port 0 --web "$PWD/apps/web/dist"
```

协调会话集成前端后，可将此命令的 `--web` 指向其构建目录，使用 Go 同源服务，避免另改 CORS 或依赖其他会话的开发端口。也可在最终集成树 `pnpm dev`。需要的人工检查：导入项目合成样本；测试长文字、代码、公式及合成图片；确认首段提前出现、最终正文不重复；生成中取消再查询 messages；用 fixtures 检查备用、部分失败、无 done，以及保存成功但消息同步查询失败。Markdown/滚动/动画和 Electron 实机效果仍由前端及协调会话人工记录，不使用浏览器自动化宣称验收。

已通过授权的 `codex queue --thread 01a10860-4250-7e32-9fda-eb455a1bcb9c` 报告 B1、B2/B3 和交付进度。没有向原有 Build frontend 或 Backend Infra CI/CD 会话派活或中断它们。

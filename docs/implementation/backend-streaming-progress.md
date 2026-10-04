# 后端流式迁移进度

工作目录：`/Users/bu44er/Developer/Projects/Reader-streaming-backend`。分支：`backend/unified-streaming`。共同基线：`85f21938f13914c48131a455cb586d4e964b90c9`。仅提交本工作树的 Go、契约、OpenAPI 和生成类型；不合并、不推送、不部署。

## B1：统一生成入口（已实现）

`GenerationService` 建立每请求的连接/模型/认证/验证能力快照。`Adapter.Stream` 输出串行内部事件及权威正文；service 校验累计正文与成功终态。CLI adapter 复用三种已合入协议。后台生成使用相同 adapter，不依赖 HTTP。普通文字、Kimi 和图片聊天合并到同一上下文/保存/SSE 生命周期。保留 Codex/Claude 普通文字无需事先能力探测的兼容入口；图片和 Kimi 仍要求验证。

`chatStreamWriter` 是唯一 SSE writer；写入或 Flush 失败取消上游，终态后禁止发送。助手成功保存后才 done；日志仅有随机内部请求 ID、首段/Flush/完成耗时和脱敏错误类别。

B1 验证：`cd apps/server && go test ./internal/reader` 通过（12.677s）。包含三种 CLI 的 gated HTTP 文字/图片、部分失败不保存、历史摘录保留、配置密钥和图片边界回归。`pnpm install --frozen-lockfile` 完成，锁文件未变。

## B2：API 真流与备用（实现中，待扩展测试）

已接入 OpenAI Chat Completions SSE，发送 `stream:true,n:1`，选择 choice 0，原样转发 content。要求 `finish_reason:stop` 和 `[DONE]`，EOF 不代表成功；不自动重发 non-stream 请求。API 不支持 SSE 时明确报错；本轮无已声明 non-incremental 连接。

首段前仅可切到已验证的对应 text-api/image-api，不切其他 Agent；文本和图片共用策略。已有回归 fixtures 已改为实际 SSE。待补 API 分片、上游错误和 gated HTTP 证据。

## B3 / B4

生命周期边界、协议取消和 OpenAPI 补全正在实施；真实模型及联合人工验收尚未执行。冻结 wire 无变更，无接口阻塞。

联调命令待正式检查后补充。历史文档的真实调用记录不作为本次重构证据。

## B2 / B3 阶段证据（2026-10-05）

B1 提交 `f7d4f28`。B2 API 专项（`TestCompletion|TestAPI|TestFallback`）通过，2.760s：六组 Agent→备用 API 文字/图片 gated HTTP 首段提前到达；一字节网络分片、CRLF/多行 data、UTF-8、choice 过滤、拒绝/截断/上游错误、缺失 stop/DONE、转义后超过 2 MiB 的合法帧、1 MiB 正文限制、重定向拒绝、emit 失败关闭 HTTP body、禁止非流重试。

B3：Codex 尝试 turn/interrupt；Kimi 发送无 ID 的 session/cancel 并继续读取原 prompt response，等待期间不转发排队文字。400ms watchdog 关闭管道/杀进程，退出时等待清理；Claude 先 SIGINT，400ms 后强制回收。补 Kimi session/version 过滤、Claude result 后迟到事件和非零退出、累计文本与结果一致性、后台 attempt 隔离、取消/超时/可见正文禁止备用、保存失败及终态丢失边界。`go test ./...` 通过，19.051s；第一轮 `go test -race ./...` 通过，31.049s，新增 HTTP 断开与 done 丢失测试后的最终检查仍在运行。

真实适配器（只用原创提示及合成色块图，非用户书籍）：

| CLI | 输入 | 片段 | 首段 | 完成 | 取消首段后返回 |
| --- | --- | --- | --- | --- | --- |
| Codex 0.160.0 | 文字 | 42 | 11.873s | 12.757s | 7.4ms |
| Codex 0.160.0 | 合成图片 | 122 | 5.668s | 9.381s | 同独立取消用例 |
| Kimi 2.0.2 | 文字 | 131 | 5.383s | 8.855s | 45.7ms |
| Kimi 2.0.2 | 合成图片 | 131 | 7.783s | 11.327s | 同独立取消用例 |
| Claude Code 2.1.220 | 文字/图片/取消 | 待验证 | — | — | auth status: loggedIn=false |

真实结果为本次重构后的单次样本，不是性能承诺。三种 CLI 的模拟文字/图片和取消覆盖不等于 Claude 真实验证。未使用商业备用 API key，API 真实传输由本机 HTTP 上游测试验证，厂商端兼容性尚未实测。

B4 已补 OpenAPI `ChatStreamEvent` 联合 schema、SSE 示例及生成类型，保持原 string wire。共用回放 fixtures：`docs/fixtures/agent-streaming-v1.json`（success/fallback/partial-error/missing-terminal），前端可只读消费，无新字段。当前基线没有文档删除 HTTP 接口；保存前再次检查文档且数据库外键保护，不宣称新增删除动作的主动取消联调。

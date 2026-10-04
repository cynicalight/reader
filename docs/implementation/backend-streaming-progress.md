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

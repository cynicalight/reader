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

前轮后端单独预览曾运行在 `http://127.0.0.1:65219`，使用独立临时书库及本工作树构建的基线 UI。当前 F4 联调使用下节的 `17840` 后端与 `15174` 前端；此处仅保留早期预览证据。HTTP 检查 `/`、health 和带认证 documents 返回 200，无认证 documents 返回 401。启动状态和本机会话 token 存在权限 0600 的 `/tmp/reader-streaming-backend-preview.json`，不进 Git。打开方式：读取该文件，将 `url + '/#token=' + token` 作为地址。预览是进程存活期间的本机地址，不是部署或合并前端后的视觉验收。

重新启动可在此工作树运行：

```sh
pnpm build
apps/desktop/bin/reader-server --data "$(mktemp -d /tmp/reader-streaming-preview.XXXXXX)" --port 0 --web "$PWD/apps/web/dist"
```

协调会话集成前端后，可将此命令的 `--web` 指向其构建目录，使用 Go 同源服务，避免另改 CORS 或依赖其他会话的开发端口。也可在最终集成树 `pnpm dev`。需要的人工检查：导入项目合成样本；测试长文字、代码、公式及合成图片；确认首段提前出现、最终正文不重复；生成中取消再查询 messages；用 fixtures 检查备用、部分失败、无 done，以及保存成功但消息同步查询失败。Markdown/滚动/动画和 Electron 实机效果仍由前端及协调会话人工记录，不使用浏览器自动化宣称验收。

已通过授权的 `codex queue --thread 01a10860-4250-7e32-9fda-eb455a1bcb9c` 报告 B1、B2/B3 和交付进度。没有向原有 Build frontend 或 Backend Infra CI/CD 会话派活或中断它们。

## 双 worktree 联调启动（2026-10-05 补充）

可运行后端候选为 `backend/unified-streaming@47aab55`（实现提交 `2f7f820`，含完整联调启动文档）；本节只补启动文档，不改变 Go 或冻结 wire。B2/B3 当前没有已知未完成的实现项，模拟/HTTP 生命周期测试已通过；尚未验证的是商业备用 API 厂商端兼容性、Claude 未登录情况下无法执行的真实文字/图片/取消，以及双 worktree 的人工交互和视觉效果。这些未验证项不阻塞启动。

本轮已实际启动后端 `http://127.0.0.1:17840` 和前端 `http://127.0.0.1:15174`。启动前两端口均通过 loopback bind 检查；前端会话既有 `15173` 监听保持不动。当前独立运行目录为 `/tmp/reader-streaming-backend-integration.zo5NBG`，书库仅在其 `data/` 下；未读取用户已有 `.reader`。运行目录指针保存在 `/tmp/reader-streaming-backend-integration.current`。以下命令可复现；若本轮进程仍在运行，直接执行初始化步骤，无需再次启动。

### 终端 A：后端与独立数据目录

在后端 worktree 执行。依赖已安装；新 checkout 若缺依赖，先 `pnpm install --frozen-lockfile`。不要运行顶层 `pnpm dev`：它会自行启动另一份 Go 并使用 worktree 的 `.reader`，不适用于本次隔离联调。

```sh
set -e
cd /Users/bu44er/Developer/Projects/Reader-streaming-backend
umask 077
python3 - <<'PY'
import socket
for port in (17840, 15174):
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', port))
        print(f'loopback port {port}: available')
PY
reader_integration_dir=$(mktemp -d /tmp/reader-streaming-backend-integration.XXXXXX)
printf '%s\n' "$reader_integration_dir" > /tmp/reader-streaming-backend-integration.current
(cd apps/server && go build -o "$reader_integration_dir/reader-server" ./cmd/reader-server)
pnpm --filter @reader/processor build
printf 'Integration state directory: %s\n' "$reader_integration_dir"
env -u READER_TOKEN \
  READER_NODE="$(command -v node)" \
  READER_PROCESSOR="$PWD/apps/processor/dist/main.mjs" \
  "$reader_integration_dir/reader-server" \
  --data "$reader_integration_dir/data" --port 17840 \
  > "$reader_integration_dir/ready.json" \
  2> "$reader_integration_dir/server.log"
```

Go 仅绑定 `127.0.0.1`。`env -u READER_TOKEN` 使每次启动生成独立会话 token；启动 JSON 重定向到 `ready.json`，不打印到共享终端或回报。`umask 077` 使运行目录及会话文件只对当前用户开放。没有复制旧书库、连接配置或 API key。处理器使用本后端工作树的构建产物，图片/PDF 解析不会误用另一会话的目录。

若端口检查失败，先确认是否正是本节已启动的进程；不要杀其他进程，也不要让 Vite 自动递增端口。`17840` 是当前前端 proxy 的固定目标，因此不能只改 Go 端口。确需换后端端口时交由前端同步修改其 proxy 配置；本后端会话不编辑前端文件。前端端口可以选另一个空闲 loopback 端口，但要同步下方初始化脚本中的 `frontend`。

### 终端 B：使用前端现有 Vite proxy

```sh
pnpm --dir /Users/bu44er/Developer/Projects/Reader-streaming-frontend \
  --filter @reader/web dev --host 127.0.0.1 --port 15174 --strictPort
```

已只读核对前端 `apps/web/vite.config.ts`：`/api` 与 `/pub` 均代理到 `http://127.0.0.1:17840`，无需修改。浏览器只访问 `15174`，SDK 的相对 `/api`、出版物和图片的 `/pub` 请求均经 Vite 转发。保留默认 `changeOrigin:false`，让 Go 收到的 Host 和浏览器 Origin 都是 `127.0.0.1:15174`，满足现有同源检查；不要额外重写 Origin 或为此扩大 CORS。只代理 `/api` 会遗漏 EPUB 资源及图片。

### 终端 C：初始化前端会话，不输出 token

先等待终端 B 显示就绪，再运行以下人工启动命令。它从本机权限受限文件读取 Reader 会话 token，并打开带 fragment 的地址；不打印该地址，不使用 CLI/API Key，不需要把 token 复制到聊天中。

```sh
python3 - <<'PY'
import json
import pathlib
import subprocess
import time
from urllib.parse import quote

run_dir = pathlib.Path('/tmp/reader-streaming-backend-integration.current').read_text().strip()
ready = pathlib.Path(run_dir) / 'ready.json'
for attempt in range(100):
    try:
        state = json.loads(ready.read_text())
        break
    except (OSError, json.JSONDecodeError):
        time.sleep(0.1)
else:
    raise SystemExit('Backend not ready; inspect server.log locally')
frontend = 'http://127.0.0.1:15174'
subprocess.run(['open', frontend + '/#token=' + quote(state['token'], safe='')], check=True)
print('Frontend opened; session value omitted')
PY
```

前端 `src/main.tsx` 从 `#token` 读取值，写入该 origin 的 `sessionStorage['reader-session']`，通过 `history.replaceState` 清除地址栏 fragment，再调用 `configureAPI(token)`。SDK 为 API 请求添加 Bearer 认证。直接打开裸地址不会自动获得新会话；重启后端、更换端口或新开未初始化窗口后应重新执行此步骤，覆盖旧 session。`/__streaming` 是无模型回放入口，不能用它代替正式 `/` 对话联调。

### 验证与停止

本轮已通过 HTTP 请求验证（无浏览器自动化）：Vite `/` 和经 proxy 的 `/api/health` 为 200；带认证 `/api/documents` 为 200，无认证为 401；带正确 Origin/认证的 POST 聊天通过安全边界后对不存在的文档返回 404；`/pub` 转发到 Go 后对不存在的出版物返回 404；外部 Origin 返回 403。这些检查确认代理和认证通路，不代表视觉、真实文档资源或实际对话验收完成。

必要后端复验：`cd apps/server && go test ./internal/reader -run 'TestAuthBoundaries|TestChatStreamsOverHTTP|TestAPIFallbackStreamsOverHTTP|TestHTTPDisconnect|TestFrozenStreamFixtures' -count=1` 通过（9.003s）。此前正式全量检查见上文；本补充仅改文档，没有重复所有构建。

打开正式界面后，在隔离书库导入项目合成样本。Codex/Claude 文字可按现有 CLI 登录使用；Kimi、图片及备用 API 需在这个全新的书库设置页重新做所需能力测试，不能假定已有用户书库的配置被继承。测试真实模型时仅发送原创摘录与合成图片。

前端和后端分别在自己的终端按 Ctrl-C 停止，只停止本次启动的进程。停止后暂保留临时目录，便于 messages/保存竞态核对；不要批量删除 `/tmp` 或用户书库。本轮运行中的进程由协调会话按实际需要继续使用或停止。


### 最终交付核对

已清除旧的“B2 实现中”和“真实测试尚未执行”状态，当前状态以上方“完成边界”和精确测试表为准。协调会话已核对 `ChatStreamEvent` 及四组共享 fixtures 符合冻结契约，并通知前端只读对照。B2/B3 的代码及自动测试完成；Claude 真实调用、商业 API 厂商端兼容性和 F4 人工联合验收仍明确标为未验证。

本次再次检查：`127.0.0.1:17840/api/health` 返回 200；`15174` 经 Vite proxy 的认证 documents 查询返回 200；原有 `15173/__streaming` 仍返回 200。`ready.json` 权限为 0600，未把其会话值写入文档或回报。服务已可供 F4 使用，无需等待视觉验收。

实现代码自 `2f7f820` 后未改变。本轮沿用该代码已经完成的 `pnpm test`（Go 20.556s，16 个 Vitest 文件 / 46 项）及 `go test -race ./...`（35.858s）证据；启动补充另执行必要后端用例通过（9.003s）。后续提交仅维护交付文档，没有将旧记录表述为新执行的测试。正式检查、启动命令、临时书库和不输出 token 的会话初始化脚本均在本文件内可重现。

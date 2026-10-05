# EPUB 原文阅读：第一版

实现日期：2026-10-05。基于 `6bfea8a` 创建 `feat/epub-reading`，工作目录为相邻的 `Reader-epub` worktree。保留现有 Readium Go Toolkit 0.16.1、Navigator 2.11.1 和 shared 2.6.0。

## 使用范围

EPUB 在现有原文阅读区显示。目录、翻页、滚动、字体和主题继续由 Readium 处理。划词工具栏、笔记列表、批注编辑/删除与 AI 引用沿用主线已有交互。首次调研后主线已经接通正文高亮的点击和悬停，本分支复用该实现。

本版补齐以下行为：

- 跨粗体、链接、段落，以及以元素为起止边界的选区，归一化为文本节点与 UTF-16 字符偏移；不向正文插入标记节点。
- 同时保存精确 DOM 范围、原文和前后文。恢复时核对内容；路径失效后只接受唯一匹配。定位不明确时保留数据库中的笔记、跳过错误高亮并提示。
- 高亮与笔记跳转使用同一份经过核对的精确范围，避免重复文字跳到首个匹配。
- 搜索按章节内每次出现生成精确位置，最多返回 100 项；支持大小写不同的匹配和查询中的连续空白。跨块文本如果在索引与 DOM 中使用了不同的空白规则，仍可能无法生成对应结果。
- 键盘选区经 Readium 的 frame 事件通道进入原有划词工具栏。
- 批注异步恢复使用版本检查，避免删除后被旧请求重新绘制；关闭阅读器时取消资源请求和待完成导航。
- Go 校验内外层章节位置的一致性、范围及进度字段；兼容旧版空 locator。批注定位错误不会阻止正文打开。

## Readium 补丁

`pnpm-workspace.yaml` 与 lockfile 记录两个固定版本的补丁，`pnpm install --frozen-lockfile` 会自动应用：

- `patches/@readium__navigator@2.11.1.patch`：存在 domRange 时，`loadLocator` 向 frame 发送完整序列化 Locator；精确跳转失败不降级为章节进度。
- `patches/@readium__navigator-html-injectables@2.8.4.patch`：分页、滚动、竖排和 WebPub 的 `go_text` handler 接收完整 Locator，沿用原有 Range 解析及滚动逻辑；旧消息格式继续有效。

补丁同时包含 npm 包的 `src` 和实际执行的 `dist`。minified dist 是整行 diff，因此补丁文件字节数大于逻辑改动。`epub-readium.test.ts` 实际加载安装后的 dist，将 Navigator 发出的消息交给真实 Snapper handler，验证长段落内重复文字的字符偏移。测试模拟几何尺寸，不代表浏览器排版已验收。

升级 Readium 时先检查上游是否已经贯通精确 Locator，再移除或重做补丁。不能只更新 shared 或只保留一半补丁。

## 验证结果

在本 worktree 的 macOS 环境完成：

- `pnpm typecheck`：通过。
- `pnpm test`：Go 全套通过；Vitest 51 个文件通过、1 个文件跳过，235 个用例通过、3 个跳过。
- `pnpm build`：Go、processor、web、Electron 构建通过。仍有现有依赖的纯函数注释与大 chunk 提示。
- 隔离书库的真实 HTTP 检查：导入验收 EPUB、读取 3 个章节及 positions、给第二处重复句保存笔记、读取并恢复到第二处、保存阅读位置、删除批注均通过；预览页面 HTTP 200。
- Go 回归覆盖完整 Locator 数据库关闭重开后保持不变及删除；前端覆盖元素边界、重复引用、失效路径、精确导航、键盘选区、删除期间的延迟请求。

修复了预览空白：旧 `positions.json` 缺少 `total`，shared 2.6.0 的 `positionsFromManifest()` 会返回空列表，Navigator 因此无法创建章节 iframe。导入时写入总数，资源接口也为旧缓存补齐总数，不改动进度和笔记。适配器现在拒绝空位置列表，并报告 Navigator 打开失败。

用户提供的本地 `docs/MAKE.epub` 已导入隔离预览书库。真实 HTTP + 已安装 Readium shared/FrameBlobBuilder 检查通过：319 个位置、127 个章节均可构建为合法 XHTML；原测试书的 3 个位置和 3 个章节也通过。此项检查未执行 iframe 内脚本或浏览器排版，不能代替视觉验收。本地书籍文件不随代码提交。

修复了正文缩在左上角及白底黑字：应用需为 Readium 的重排 iframe 明确设置宽高，否则使用浏览器默认视口；服务器 `style-src` 也需允许 Readium 注入的 `blob:` 样式表。Blob 文档会继承创建者的安全策略，见 [HTML 标准的 policy container 规则](https://html.spec.whatwg.org/multipage/browsers.html#policy-containers)。新增测试检查真实 FrameManager 元素是否匹配构建后的尺寸规则，并检查 HTTP CSP 的样式来源。固定版式的嵌套 iframe 继续使用 Readium 自身尺寸。

修复了 EPUB 划词后不出现共用工具栏：Readium 使用 `contentWindow.location.replace()` 导航章节，iframe 的 `src` 属性不随之更新。适配器改用活动 FrameManager 的 `source` 匹配选区事件，键盘选区也使用同一来源；旧章节的延迟选区不覆盖当前选区。沿用 PDF 的高亮、下划线、笔记、翻译、问 AI、引用和取消入口，以及已有批注的编辑和删除操作。测试使用空 `iframe.src` 加真实形态的 Blob 来源，覆盖选区坐标和三种批注的恢复、删除。

未执行浏览器自动化或桌面视觉验收。

## 人工验收

运行 `python3 scripts/create-epub-check.py` 生成 `.reader/epub-check.epub`。文件完全使用项目原创测试文字，包含重复句子、跨节点内容、中文/emoji/ruby、长段落与脚注。

1. 打开「EPUB 批注验收样本」，给第一章第二处重复句添加高亮、下划线或笔记。
2. 调整字号、行距及窗口宽度，切换分页/滚动，再切章、关闭并重新打开。
3. 点击笔记回原文，确认目标仍为第二处；点击正文批注，检查编辑与删除。
4. 跨粗体、链接和两个段落划词；第二章选择长段落靠后的文字，检查返回时的分页位置。
5. 搜索 `Reader`，逐一打开结果；删除批注后切章返回，确认没有旧高亮。

可在独立测试书库启动已构建的预览，端口 `0` 会自动选择空闲本机端口：

```sh
./apps/desktop/bin/reader-server --data .reader/epub-preview --port 0 --web apps/web/dist
```

启动行返回 `url` 与当前会话 `token`，使用 `<url>/#token=<token>` 打开。此命令使用隔离书库。正式 Electron 的字体、原生窗口与缩放仍需人工检查。

## 本版限制

固定版式、RTL、中文竖排和复杂脚注尚未用真实出版物人工验收；协议测试通过不构成这些版式的支持认证。纯图片 EPUB 没有新增 OCR。跨章节的单次连续选区、DRM、EPUB 全文译文并排、内容版本迁移不在本版实现范围。失效笔记可保留和删除，尚无手动重新绑定原文的界面。

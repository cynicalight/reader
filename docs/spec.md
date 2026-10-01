# Reader v0.1

用户目标：新建 local-first AI 阅读器。Electron + React/TypeScript + Go，使用 shadcn/ui 与 Base UI。EPUB 和 PDF 是一等公民，统一 Document / DocumentLocation / TOC / Annotation，保留本机 Claude Code / Codex CLI 的订阅账号使用方式。

本轮交付一版可运行的纵向实现：本地文件导入、书库、最近阅读、收藏、设置、三栏阅读界面；Readium EPUB + PDF.js PDF；目录跳转、文字选择、搜索、阅读位置恢复、字体与主题；书签、高亮、下划线、笔记、Markdown 导出；选区翻译/解释、多选区对话、章节/当前 PDF 页总结；CLI 安装与登录检测、subprocess 调用、SSE、取消与对话持久化。Electron 管理 Go 生命周期与原生文件选择。OpenAPI 描述本地业务接口并生成客户端类型。

边界：第一版支持无 DRM EPUB 与含文本 PDF；扫描 PDF 不含 OCR。PDF 连续滚动、适宽、缩放和目录可用，缩略图与双页模式留到后续。EPUB 支持重排、分页/滚动、Readium locator 装饰，但复杂固定版式和跨语言书籍尚需真实样本人工验收。全文检索首版为 EPUB FTS5 与 PDF.js 逐页文本查找；跨书库正文搜索、后台 PDF FTS、批量翻译、词典、生词本、统计、Ollama/API provider 留到后续。文件关联仅接入 macOS open-file 生命周期；签名安装包和系统注册不在本轮。

验证：Go 集成测试覆盖持久化、导入/解析与权限边界，前端类型检查与生产构建，PDF.js 对真实测试 PDF 的解析，桌面进程与 HTTP 健康检查。不得用浏览器自动化作为 UI 验收，提供人工验证步骤。

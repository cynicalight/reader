# Reader Connector（Chrome 首版）

扩展位于 `apps/connector`。在仓库根目录运行 `pnpm --filter @reader/connector build`，然后打开 Chrome 的 `chrome://extensions`，开启开发者模式，点「加载已解压的扩展程序」并选择 `apps/connector/dist`。扩展仅在点击工具栏按钮后读取当前标签页；第一次收录时，Chrome 会询问网站访问权限，用于读取所选论文页面、PDF 和快照图片。

启动 Reader 桌面版后，点击扩展即可自动连接。Reader 的连接入口固定监听 `127.0.0.1:17841`，只接受本扩展的固定 Chrome 来源。扩展 ID 为 `afojfnpkeokahhniipldpdpecaljdnbe`；如果此前加载过不含固定 ID 的开发版，请在 `chrome://extensions` 移除旧版，再加载当前 `dist`。插件自动取得本机访问凭据并保存在 Chrome 本地存储，Reader 只保存凭据哈希。若端口被占用，设置页会显示连接不可用。连接不向 Zotero 或 Reader 云端发送内容。

测试开发版插件连接时，先关闭已安装的 Reader，再以 `READER_DEV_CONNECTOR=1 pnpm desktop` 或 `READER_DEV_CONNECTOR=1 pnpm dev` 启动开发版。

点击扩展按钮后，单篇页面会显示一篇候选论文；识别出的搜索结果页可逐篇勾选。可填分类和用逗号分隔的标签。扩展尝试用当前浏览器会话下载 PDF，将 PDF、论文信息与静态网页快照送入 Reader。Reader 继续执行 PDF 内容哈希去重、50 MB 与 150 页上限；51–150 页会询问是否继续。只有取得 PDF 并完成导入后才保存快照。论文详情中的「查看网页快照」可以离线阅读正文、表格、链接和成功嵌入的图片。单张图片限 2 MB，整个快照限 10 MB；不能离线保存的图片会在逐篇结果中提示。快照没有站点脚本、表单或远端资源。

第一批识别规则覆盖通用 `citation_*`、Dublin Core、JSON-LD 元数据，并识别 arXiv、Google Scholar、PubMed、Semantic Scholar 的部分结果列表。有 DOI 时还会尝试从 Crossref 补全缺失的信息。规则依赖站点当前页面结构；登录态、反爬限制、订阅页面及跨站 PDF 下载可能导致单篇失败，扩展会逐篇显示结果。Chrome PDF 查看器无法注入页面脚本时仍可尝试收录，上传前会校验 PDF 文件签名。没有 PDF 的页面不会创建 Reader 条目。扩展暂不处理 Zotero 云端、机构代理、Google Docs 引用或书目格式文件自动导入。

手动验收：用一篇 arXiv 论文检查自动连接、单篇收录、论文信息、PDF 阅读与离线快照；在 Google Scholar 或 arXiv 搜索结果中选择两篇，核对逐篇结果与去重；打开需要登录的 PDF 验证当前会话可用性及失败提示；重启 Reader 后确认自动恢复连接；关闭 Reader 后确认扩展不能继续写入。视觉检查需要在 Chrome 和 Reader 桌面版中手动完成。

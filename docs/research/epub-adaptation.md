# EPUB 原文阅读与批注适配调研

调研日期：2026-10-05。产品范围：EPUB 显示在现有「原文」阅读区，保留划词、复制、高亮、笔记和跳回原文等交互。本文区分官方规范、指定版本源码事实与设计建议；静态分析不代表已完成真实书籍的视觉验收。

## 结论

建议继续使用 **Readium**。项目约定已经指定 Readium；其 TypeScript Navigator 提供章节导航、流式/固定版式、选区通知与 decoration（把批注绘制到正文的装饰层）。目前没有足够证据支持为了 EPUB 换成另一套引擎。PDF 和 EPUB 可以共享批注业务、侧栏与工具栏；底层位置表达和绘制必须分别适配。[Readium 仓库][readium-repo]

EPUB 的难点不是读出 ZIP 内的文字，而是保持章节样式、资源路径、流式重排与批注位置一致。**高亮能恢复到准确文本，不等于点击笔记一定能跳到同一个准确位置**：Readium 2.11.1 的 decoration 和 `go(locator)` 使用不同的数据传递路径，详见下文。[导航源码][navigator] [范围解析源码][locator-helper]

## 格式解析应分成哪些层

EPUB 容器包括 `META-INF/container.xml`、OPF package、内容文档和资源。OPF 的 `manifest` 声明资源，`spine` 声明主要阅读顺序；目录与阅读顺序不能混为一谈。EPUB 3 使用 Navigation Document，兼容 EPUB 2 时还需解析 NCX。`rendition:layout` 区分流式与固定版式。流式布局的屏幕分页随字号、窗口和字体变化；固定版式也不意味着一定存在可选择文字，纯图片页仍需另行处理。[EPUB 3.3][epub-spec] [epub.js 解析源码][epubjs-package] [Foliate 解析源码][foliate-epub]

建议职责分离：服务端读取容器、元数据、目录与资源，清洗主动内容并提供资源地址；Readium 在浏览器内显示 XHTML/CSS、分页或滚动并处理选区；应用保存批注与笔记。提取的纯文本可以用于搜索或 AI，但不应替代「原文」中的 EPUB 版式。Readium TS 的 Navigator 消费 Publication/资源，不能把安装 Navigator 当作已经完成服务端 EPUB 解析。[Readium 包职责][readium-repo]

后端继续使用已经锁定的 `github.com/readium/go-toolkit v0.16.1`。本项目的 `prepareEPUB` 先检查 ZIP 资源数量与解压大小，再通过 `epub.NewParser(...).Parse` 构造 Publication，以 `p.Get` 读取资源、`p.Positions` 生成位置列表。这条链路已经有样本导入测试，无需为适配正文交互另写 OPF/NCX 解析器。Go Toolkit 的在线 README 较简略，版本行为应结合安装的模块源码和项目测试确认。[Go Toolkit][go-toolkit] [本地集成](../../apps/server/internal/reader/epub.go)

## 候选技术比较

下表是本次官方文档与源码审计结果，不是完整 EPUB 标准一致性认证。

| 方案       | 解析、版式与定位                                                                                 | 划词、高亮与笔记接入                                                                                               | 许可证与取舍                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Readium TS | Publication/Locator 模型；存在流式与 FXL 路径；EPUB 2/3 容器与目录兼容还取决于上游 parser        | `textSelected`、`applyDecorations`、`registerDecorationObserver`；选区持久化需补齐精确 locator；笔记存储由应用提供 | BSD-3-Clause。符合现有架构；需核实具体版本每条 locator 消费路径                   |
| epub.js    | OPF、EPUB 3 nav、EPUB 2 NCX；流式/`pre-paginated`；以 EPUB CFI 表达位置                          | `selected(cfiRange, contents)`、`annotations.highlight`、`book.getRange`、`rendition.display`；上层管理笔记        | npm 标记 BSD-2-Clause，仓库保留两条款许可文本。功能示例直接，npm 正式发布较旧     |
| foliate-js | EPUB parser 包含 EPUB 2 兼容与 EPUB 3 nav；流式 renderer 和 fixed-layout renderer；CFI/DOM Range | `getCFI`、`addAnnotation`、`draw-annotation`、`show-annotation`；SVG overlayer 绘制与命中测试                      | MIT。模块可读性较好；应用需要封装生命周期、类型和资源策略；固定版式批注需单独验证 |

来源：[Readium][readium-repo]、[epub.js API][epubjs-api]、[高亮示例][epubjs-highlight]、[epub.js OPF][epubjs-package]、[Foliate README][foliate-readme]、[Foliate view][foliate-view]、[Foliate EPUB][foliate-epub]。Foliate fixed-layout 高亮有尚未关闭的报告；这仅能说明存在待核实场景，不能据此宣称全部固定版式高亮都不支持。[问题 #83][foliate-fxl-issue]

许可证文本分别见 [Readium BSD-3-Clause](https://github.com/readium/ts-toolkit/blob/ca428e33b79c91a72cefb21ac922576859fe23dd/LICENSE)、[epub.js 两条款许可](https://github.com/futurepress/epub.js/blob/eee359d0790002115a1156a9833c54f4bcd44c1d/license)、[foliate-js MIT](https://github.com/johnfactotum/foliate-js/blob/78914aef4466eb960965702401634c2cb348e9b1/LICENSE)。

epub.js 官方 API 明确列出 CFI 实现边界：支持字符偏移和简单范围，但未实现文本位置 assertion、时间/空间偏移。Foliate 文档说可解析/输出这些 CFI 字段，但渲染时尚未应用部分字段。**支持 CFI 不等于具备所有 CFI 自动纠错能力。**[epub.js API][epubjs-api] [Foliate CFI 文档][foliate-readme]

### 维护与版本快照

| 对象                 | 2026-10-05 查询结果                                                                                              | 解释                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `@readium/navigator` | npm latest `2.11.1`，发布于 2026-09-30；依赖 shared `2.6.0`、injectables `2.8.4`、decorator `1.2.4`              | 本报告针对这组发布包源码                          |
| `@readium/shared`    | npm latest `2.7.0`，发布于 2026-10-01                                                                            | 不能单凭 latest 将 Navigator 的 shared 换成 2.7.0 |
| `readium/ts-toolkit` | 默认分支 HEAD `ca428e33b79c91a72cefb21ac922576859fe23dd`，提交日期 2026-10-02；未归档                            | HEAD 与指定 npm 包不能混为一谈                    |
| `epubjs`             | npm latest `0.3.93`，发布于 2022-02-16；仓库 HEAD `eee359d0790002115a1156a9833c54f4bcd44c1d`，2026-03-24；未归档 | npm 发布较旧不等于仓库完全停止维护                |
| `foliate-js`         | HEAD `78914aef4466eb960965702401634c2cb348e9b1`，2026-05-01；未归档                                              | 应固定提交评估；本次未验证正式 npm 发布节奏       |

来源为 npm registry 的 `dist-tags`、`time`、版本包声明与 GitHub API 的仓库/默认分支提交响应。以上只是时间快照，不能推导维护者响应速度或长期承诺。[navigator registry][navigator-registry] [shared registry][shared-registry] [epubjs registry][epubjs-registry] [Readium commits][readium-commits] [epub.js commits][epubjs-commits] [Foliate commits][foliate-commits]

## EPUB 的位置与批注模型

Readium Locator 包含资源 `href`/`type`，可附带章节内进度、全书进度、片段和文本引用。HTML 扩展支持 `cssSelector`、`partialCfi`、`domRange`；后者记录起止元素选择器、直接子文本节点索引与字符偏移。`text.highlight/before/after` 提供选中文本和前后文。规范要求用于范围定位的这些文本保留原始 DOM 字符数据；展示时再做清理。[Locator 模型][locator-spec] [HTML 扩展][locator-html]

CFI 是 EPUB 的结构位置表达，可以指向一个位置或一段范围；它不是屏幕坐标。Web Annotation 的 `TextQuoteSelector` 使用 `exact/prefix/suffix`，`TextPositionSelector` 使用文本流中的起止偏移。后者在文本插入删除后会漂移；重复文本也使仅凭 quote 的匹配不唯一。这些标准解释了为何需要多个位置线索，未要求应用必须直接采用完整 JSON-LD 模型。[CFI][cfi-spec] [Web Annotation][annotation-spec]

**设计建议：**保存 document ID、原始资源相对 `href`、精确 DOM 范围、原始 quote 与上下文；结合文件内容指纹或明确的版本标识。屏幕矩形仅用于当次工具栏定位和绘制。更改字号后重新解析范围并计算矩形。批注色彩、笔记正文、时间等业务字段与 PDF 共用；EPUB 位置类型保持独立。不要将显示页码或章节进度作为高亮的唯一锚点。

建议恢复顺序为：资源身份确认 → 精确范围解析并核对选中文本 → 带上下文的文本匹配 → 可确认的有限回退。多个候选无法区分时显示定位失败/待恢复，保留原笔记，不自动绑定第一处。进度可帮助用户返回大致位置，但不能据此绘制“精确高亮”。这是应用策略建议；下列 Readium 实际默认行为尚未包含全部保护。

## Readium 2.11.1：iframe 选区、装饰与跳转的实际路径

### 选区事件没有自带完整范围

`navigator-html-injectables@2.8.4` 的 `Peripherals.onPointUp` 读取 iframe 内的 `window.getSelection()`，取第一段 `getClientRects()` 矩形，发送 `text_selected`。数据为 `text/x/y/width/height/targetFrameSrc`。Navigator 根据来源 frame 补一个含 `href/type/text.highlight` 的 Locator，然后调用应用的 `textSelected`。该事件本身不包含起止 DOM 节点或 `domRange`。[Peripherals][peripherals] [EpubNavigator][navigator]

因此应用需要在选区仍存在时，从正确 iframe 捕获并序列化精确范围，同时记录前后文。原文 DOM 的范围与父页面工具栏坐标是两个独立问题。iframe 内的矩形需要换算到外部阅读区；固定布局的缩放和双页显示还需额外验证。鼠标 pointerup 的通知也不能代替对键盘选区、触控等输入路径的验收。

### decoration 具备恢复和点击机制，应用要接线

`applyDecorations(decorations, group)` 按 ID 对比 add/update/remove，按 locator 的 `href` 向相应 frame 发送 `decorate`，frame 重新加载时重放。iframe 的 Decorator 由 `rangeFromLocator` 恢复 DOM Range，再走覆盖层或可选 CSS Highlight API。不要以为高亮必须向正文包裹 `<mark>`；覆盖层可以避免因插入正文节点而改变定位结构。[Navigator][navigator] [Decorator][decorator]

`rangeFromLocator` 的实际优先级是 **domRange → text-fragment directive → quote（可限定 CSS 范围，带 prefix/suffix）→ CSS/HTML ID**。这里 text fragment 指 `:~:text=`，不是 EPUB CFI；此实现没有 `partialCfi` 解析分支。domRange 一旦成功即返回，未用 quote 验证内容是否仍一致。找不到 quote 会返回 null；样式成功绘制不是位置正确性的独立证据。[范围解析源码][locator-helper]

`registerDecorationObserver(group, { onDecorationActivated })` 才会启用对应组的点击事件。回调获得 decoration、group、rect、point；返回 true 表示已处理，并影响后续点击翻页逻辑。库不会替应用打开笔记编辑器。应用应将 decoration ID 映射到 annotation ID，再使用现有笔记 UI。[Navigator][navigator]

### go(locator) 尚未贯通 domRange

`EpubNavigator.loadLocator` 提取顶层 `cssSelector`，优先发送 `text` 和可选 CSS selector 给 `go_text`；失败后尝试 HTML ID 和 progression。**它没有传递 locator.locations.domRange。**`ColumnSnapper` 的 `go_text` handler 重建 Locator 时也仅含 text 和顶层 CSS selector，然后才调用 `rangeFromLocator`。因此现版本的 decoration 可以按 domRange 消除重复文本歧义，`go` 却仍可能通过 quote 跳到另一处。[Navigator loadLocator][navigator] [ColumnSnapper][column-snapper]

设计建议：先用重复段落和重复章节标题测试现状，再决定在 adapter 提供准确导航补充，或向上游提交贯通完整 Locator 的修复。不要因增加持久化 domRange 就宣称已修复精确跳转。固定布局 `FixedSetup` 对 `go_text/go_id/go_progression` 只是确认收到，不能视为页内精确滚动实现；固定版式需独立定义跳转和缩放体验。[FixedSetup][fixed-setup]

### 通信不等于内容隔离

Readium 使用 `postMessage` 消息、channel ID 与命令确认在父页面/frame 间传递事件。该版本 frame sandbox 为 `allow-same-origin allow-scripts`，因为引擎脚本需要运行；这不是允许 EPUB 自带脚本运行的理由。导入内容清洗、资源访问限制和 CSP 必须独立设计。不要向 EPUB 内容暴露 Electron bridge 或凭证。[FrameComms][frame-comms] [FrameManager][frame-manager]

## 项目现状与已确认需求

用户于 2026-10-05 确认：EPUB 正文显示在现有「原文」阅读区域，沿用 PDF 的划词、高亮、下划线、笔记和引用交互。此处“原文的位置”指界面区域。此轮交付调研及实施方案，尚未修改业务代码。

本地审计基线：`main`，`26b35fb`；调研开始时工作区干净，分支比 `origin/main` 超前 6 个提交。当前源码已经包含 EPUB 基础链路，因此下一步是补齐与验收，不能仅凭文件存在宣称 EPUB 已完整适配。

| 层次               | 已有代码证据                                                                                                                                        | 能确认的能力与边界                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 导入与解析         | [epub.go](../../apps/server/internal/reader/epub.go) 的 `prepareEPUB`；[server.go](../../apps/server/internal/reader/server.go) 的 `importDocument` | Go Readium 解析 manifest、readingOrder、TOC、positions；输出清洗后的资源及章节搜索文本                          |
| 资源与存储         | [server.go](../../apps/server/internal/reader/server.go) 的 `resource / saveAnnotation / annotations`                                               | 资源 capability 校验；原文件与派生缓存分离；批注 JSON 存入 SQLite，已有 EPUB 位置类型                           |
| 原文区域           | [Workspace.tsx](../../apps/web/src/Workspace.tsx) 的 `ReadingView` 分支；[ReaderView.tsx](../../apps/web/src/ReaderView.tsx)                        | PDF 使用 `PDFReadingView`，EPUB 使用 `ReaderView`，占用同一 reading-pane；引擎按格式动态加载                    |
| 阅读与主题         | [epub.ts](../../apps/web/src/readers/epub.ts) 的 `open / getTOC / next / previous / setTheme`                                                       | 已接 Readium，传入字号、字体、行距、页边距、滚动和主题；实际复杂书籍表现尚未人工验收                            |
| 划词与精确位置     | [selection-locator.ts](../../apps/web/src/readers/selection-locator.ts)                                                                             | 保存两端 CSS 路径、文本节点索引、字符偏移，以及选中文本和前后各 64 个 UTF-16 code unit；支持区分 DOM 中重复句子 |
| 高亮与下划线       | [epub.ts](../../apps/web/src/readers/epub.ts) 的 `highlight`                                                                                        | 已将批注转换为 Readium Decoration，按 annotation ID 更新同一组；笔记也用高亮表示，书签不绘制                    |
| 笔记与 AI 选区操作 | [Workspace.tsx](../../apps/web/src/Workspace.tsx) 的 `annotate / SelectionToolbar` 与 notes-list                                                    | 两格式共用创建、列表、删除、点击回原文和选区翻译/解释/引用到对话；不需要另建 EPUB 笔记系统                      |
| 领域接口           | [reader-core](../../packages/reader-core/src/index.ts) 的 `ReaderAdapter / EPUBLocation / Annotation`                                               | EPUB 是 href + locator + progression，PDF 是 page + rects；已有统一业务接口                                     |

真实调用链如下：

```text
导入 EPUB
  → Go prepareEPUB：解析包、清洗资源、生成 manifest/positions/章节文本
  → Workspace 原文区域 → ReaderView → EPUBReaderAdapter.open
  → Readium iframe 排版 XHTML
  → textSelected → selectionLocator → ReaderSelection
  → 共用划词工具栏 → annotate → API → SQLite
  → annotations 更新 → ReaderView.highlight
  → Readium applyDecorations：在书内恢复高亮/下划线
```

工具栏的屏幕坐标只决定按钮显示位置。它不进入持久化定位。用户改字号、窗口宽度或阅读模式后，应该重新计算绘制位置，继续使用保存的文本锚点。

## 需要补齐的项目差距

下面区分源码已确认的行为与尚待验证的风险。

1. **元素边界选区会被丢弃，源码确认。** `selection-locator.ts` 的 `point` 只接受文本节点；浏览器 Range 端点也可能是元素及其子节点偏移。应归一化到真实文本边界，并覆盖跨段落、粗体/链接混排、整段选择、emoji、组合字符和 ruby。跨章节通常跨 iframe，需要定义为多段锚点或明确限制；不能将它当作一个普通 DOM Range。
2. **绘制精确高亮与精确跳转尚未统一，源码确认。** 已安装 Navigator 2.11.1 的 `loadLocator` 传递 text 和顶层 cssSelector，未传递 `domRange`；injectables 2.8.4 的 Decoration 解析却会优先使用 domRange。即使前后文通常能消歧，重复正文及重复前后文仍有误跳风险，尚未做真实书籍复现。实现时先恢复并核对目标文本范围，再通过 Navigator 支持的定位方式跳转；若需补丁，应固定版本并增加导航回归，不直接操作分页容器的任意 scrollTop。
3. **正文高亮点击尚未连接笔记 UI，源码确认。** adapter 调用了 `applyDecorations`，但没有注册 `registerDecorationObserver`。若要求点击已有高亮显示对应笔记，可通过统一的 annotation ID 事件交给 Workspace，避免让底层引擎持有笔记业务状态。现有两格式的笔记编辑能力需另行盘点，不能将“功能一致”解释为现有 UI 已有所有编辑能力。
4. **旧锚点失效需要可见的恢复策略。** 当前 domRange 若解析成功，不代表它仍指向原来的文字。源文件不变且清洗规则稳定时较可靠；清洗器升级、缓存重建或内容替换可能改变 DOM。建议记录资源内容哈希和锚点版本；恢复时核对 quote，失败后在同章以 quote + before/after 找候选。多处匹配时让用户选择，找不到则保留笔记并提示定位失败，不自动绑定第一处。
5. **搜索只有章节级结果，源码确认。** 后端 `search` 按章节返回 href + quote，没有逐次出现的精确范围。同章重复词句无法提供独立候选，引用定位也受影响。应增加章节内匹配位置，并与真实 DOM 文本建立映射；索引中的空白归一化偏移不能直接当 DOM 偏移。
6. **内外层 locator 一致性尚未检查，源码确认。** Go `validLocation` 只校验外层 type、href、progression；前端优先使用内层序列化 locator。应校验内层 href 与外层一致且属于本书资源，并验证位置字段形状。目录/阅读进度可以采用较粗的 Locator；高亮/笔记创建需满足精确选区要求，避免用一个过严规则破坏已有进度数据。
7. **复杂书籍支持仍是验证项。** 固定版式、RTL、中文竖排、脚注、嵌入字体、SVG/MathML、图片型页面都要用样本验收。纯图片内容没有可直接选取的 DOM 文字；若要求划词，需要另加 OCR，不能仅靠 EPUB 解析实现。
8. **PDF 全文翻译和版面提取不自动适用于 EPUB，源码确认。** `PDFReadingView`、`PDFBlock` 和后台 `enqueuePDF` 按 PDF 处理。当前需求可以复用选区翻译、解释、章节上下文；若后续要 EPUB 原文/译文并排，应基于章节与段落位置建模，独立设计，不伪造 PDF 页码。

## 建议实施顺序与文件范围

| 顺序 | 可独立验证的交付                                                                                     | 主要文件                                                               |
| ---- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1    | 保持现有原文区域入口，补齐选区归一化和 DOM 范围往返；高亮/下划线/笔记在重新打开后仍指向同一文字      | `readers/selection-locator.ts`、`readers/epub.ts` 及对应测试           |
| 2    | 将笔记跳转与高亮恢复使用的精确锚点对齐；接通正文高亮点击、导航完成后的临时提示；重复内容不能静默误跳 | `readers/epub.ts`、`reader-core`、`ReaderView.tsx`、`Workspace.tsx`    |
| 3    | 补齐内层 locator 校验、旧数据兼容、定位失败状态和搜索匹配消歧                                        | Go `server.go`、`epub.go`、搜索接口；如改协议，同步 OpenAPI 与生成类型 |
| 4    | 按样本矩阵处理重排、字体、脚注、固定版式与阅读方向差异，完成桌面人工验收                             | EPUB adapter、资源处理与针对性 fixture                                 |

每一步按独立目的提交；紧密耦合的接口、实现和测试同一提交。优先保持已锁定依赖组合。只有当前版本无法满足目标且替代方案经验证后，才考虑升级或更换引擎。

## 验证记录与验收门槛

2026-10-05 在本地 macOS checkout 实际运行：

```sh
pnpm exec vitest run apps/web/src/readers/epub-selection.test.ts apps/web/src/readers/selection-locator.test.ts

cd apps/server
go test ./internal/reader -run '^(TestLibraryRoundTrip|TestAuthBoundaries|TestRejectInvalidImports|TestContentSanitization|TestLocationValidation|TestEPUBDeclaredMediaTypeSanitized|TestSVGRemainsSVG)$' -count=1
```

结果：前端 2 个测试文件、4 个用例通过；后端 7 个指定顶层测试通过，包含 EPUB/PDF 导入、进度与批注存取、资源接口和内容清洗边界。前端选区测试使用模拟 Navigator；DOM range 测试证明序列化保留第二处重复句子的节点路径，尚未证明真实 Navigator 跳转与重排恢复。后端批注往返也不等于真实选区完整 Locator 的端到端验证。

后续必须增加与数据正确性有关的测试：含精确 Locator 的数据库关闭/重开、删除后不再回绘、相同引文不同位置、跨节点选择、失败重定位不改写笔记、文档快速切换后无旧事件写入、清洗输出变更后的旧锚点行为。

人工验收在 Electron 现有入口进行：导入真实 EPUB，在原文区域划词并添加高亮/下划线/笔记；改变字号、行距、窗口宽度和滚动/分页模式；跨章往返、关闭再打开；从笔记跳回原句并删除记录；检查浅色/深色、脚注返回和高亮点击。固定版式、竖排、RTL 各用独立样本。遵守项目约定，不使用浏览器自动化进行视觉验收。

此轮仅增加调研文档，未运行全量 `pnpm typecheck / pnpm test / pnpm build`，未启动桌面验收。正式实施后需完成这三项检查与用户人工验收。

[readium-repo]: https://github.com/readium/ts-toolkit
[go-toolkit]: https://github.com/readium/go-toolkit
[epub-spec]: https://www.w3.org/TR/epub-33/
[locator-spec]: https://readium.org/architecture/models/locators/
[locator-html]: https://readium.org/architecture/models/locators/extensions/html.html
[cfi-spec]: https://w3c.github.io/epub-specs/epub33/epubcfi/
[annotation-spec]: https://www.w3.org/TR/annotation-model/#selectors
[navigator-registry]: https://registry.npmjs.org/@readium/navigator
[shared-registry]: https://registry.npmjs.org/@readium/shared
[epubjs-registry]: https://registry.npmjs.org/epubjs
[readium-commits]: https://api.github.com/repos/readium/ts-toolkit/commits?per_page=1
[epubjs-commits]: https://api.github.com/repos/futurepress/epub.js/commits?per_page=1
[foliate-commits]: https://api.github.com/repos/johnfactotum/foliate-js/commits?per_page=1
[navigator]: https://unpkg.com/@readium/navigator@2.11.1/src/epub/EpubNavigator.ts
[frame-comms]: https://unpkg.com/@readium/navigator@2.11.1/src/epub/frame/FrameComms.ts
[frame-manager]: https://unpkg.com/@readium/navigator@2.11.1/src/epub/frame/FrameManager.ts
[peripherals]: https://unpkg.com/@readium/navigator-html-injectables@2.8.4/src/modules/Peripherals.ts
[locator-helper]: https://unpkg.com/@readium/navigator-html-injectables@2.8.4/src/helpers/locator.ts
[decorator]: https://unpkg.com/@readium/navigator-html-injectables@2.8.4/src/modules/Decorator.ts
[column-snapper]: https://unpkg.com/@readium/navigator-html-injectables@2.8.4/src/modules/snapper/ColumnSnapper.ts
[fixed-setup]: https://unpkg.com/@readium/navigator-html-injectables@2.8.4/src/modules/setup/FixedSetup.ts
[epubjs-api]: https://github.com/futurepress/epub.js/blob/eee359d0790002115a1156a9833c54f4bcd44c1d/documentation/md/API.md
[epubjs-highlight]: https://github.com/futurepress/epub.js/blob/eee359d0790002115a1156a9833c54f4bcd44c1d/examples/highlights.html
[epubjs-package]: https://github.com/futurepress/epub.js/blob/eee359d0790002115a1156a9833c54f4bcd44c1d/src/packaging.js
[foliate-readme]: https://github.com/johnfactotum/foliate-js/blob/78914aef4466eb960965702401634c2cb348e9b1/README.md
[foliate-view]: https://github.com/johnfactotum/foliate-js/blob/78914aef4466eb960965702401634c2cb348e9b1/view.js
[foliate-epub]: https://github.com/johnfactotum/foliate-js/blob/78914aef4466eb960965702401634c2cb348e9b1/epub.js
[foliate-fxl-issue]: https://github.com/johnfactotum/foliate-js/issues/83

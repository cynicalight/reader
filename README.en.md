<p align="center">
  <img src="assets/logo/reader-logo.svg" width="112" alt="Reader logo" />
</p>

<h1 align="center">Reader</h1>

<p align="center"><a href="README.md">简体中文</a> | <b>English</b> | <a href="https://cynicalight.github.io/reader/">Website</a></p>

A local-first EPUB / PDF reader for books and papers, with annotations and AI assistance grounded in the text you are reading.

<p align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="website/assets/screenshots/pdf-dark.webp" />
  <img src="website/assets/screenshots/pdf-light.webp" alt="Reader reading a PDF, with contents on the left and AI assistance on the right" />
</picture>
</p>

Reader treats EPUB and PDF as core document formats. It separates books and papers into two libraries, with shared reading, annotation, and chat tools, with Readium and PDF.js powering their respective reading experiences. Documents, reading progress, and notes stay on your machine. AI features use an already authenticated Claude Code, Codex CLI, or Kimi Code CLI, without requiring a separate API key in Reader.

Run from source, or use installers built by CI after a Release is published: DMG for Apple Silicon Macs and EXE for Windows x64. Installers have no developer certificate and may require approval in your system security settings. See the [packaging and release guide (Chinese)](docs/releasing.md) for the workflow and validation scope. Windows installation still requires manual acceptance; Linux installers are not provided.

## Features

- **Paper management**: separate book and paper libraries; paper metadata lookup, DOI / arXiv / URL / title import, nested categories, tags, table view, reading status, duplicate detection, and related papers. The paper library accepts PDFs up to 50 MB and 150 pages; if the page count cannot be read, only the size limit is checked.
- **Citations and recovery**: export GB/T 7714, APA, BibTeX, and RIS citations; recover deleted documents from the trash, with files, annotations, and conversations preserved until permanent deletion.
- **Paper reading**: question annotations linked to AI answers, annotation tags and filters, document notes, PDF internal-link previews, and desktop `reader://` links. See [paper-library behavior and manual checks (Chinese)](docs/paper-library.md).

- **Local library**: import or drag in EPUB / PDF files, preserve originals, deduplicate by content, search your library, and browse recent reads and favorites.
- **Shared reading interface**: contents and search on the left, the document in the center, and AI chat and notes on the right. Resize or hide the sidebars.
- **Reading records**: bookmarks, highlights, underlines, notes, reading position restoration, and Markdown annotation export.
- **AI assistance**: translate or explain selections, reference multiple excerpts, summarize the current EPUB chapter or PDF page, revisit conversation history, and cancel generation.
- **CLI account integration**: detect local Claude Code / Codex CLI / Kimi Code CLI installations and login status, then use your existing account through the official CLI.

Each format retains reading controls suited to its layout:

| Capability                | EPUB                                                                 | PDF                                              |
| ------------------------- | -------------------------------------------------------------------- | ------------------------------------------------ |
| Reading engine            | Readium Web + Go Toolkit                                             | PDF.js Viewer                                    |
| Navigation                | Nested table of contents, chapter navigation                         | Document outline, page navigation                |
| Layout                    | Paginated / scrolling, font size, font family, line spacing, margins | Continuous scrolling, zoom, fit to width         |
| Search                    | SQLite FTS5 with literal substring matching                          | Per-page text search                             |
| Positions and annotations | Readium locators and decorations                                     | Page numbers and normalized selection rectangles |

In an empty library, click “先体验示例文档” (try sample documents) to load an original three-chapter EPUB and a two-page PDF included with the project.

PDF processing appears as a quiet overlay on each library cover, showing **Learning** then **Translating**; completion fades upward, and the overlay disappears when finished. Learning extracts page text and layout locally; translating translates body text and captions and converts formula images to LaTeX. Hovering a detected figure or formula highlights the whole region without blocking text selection. Processing resumes after restart and reuses saved translations.

The first PDF analysis automatically downloads and verifies approximately 67 MB of layout-model weights, then caches them locally. Python and PaddlePaddle do not need to be installed. Select a primary agent in Settings and run the actual text/image capability test to enable translation and formula conversion. Without a verified connection, reading and detected-region hover remain available while translation waits. Scanned pages currently require OCR that is not implemented; incomplete text is explicitly labeled.

**Formula conversion sends cropped PDF formula images to the selected agent.** Figures and tables are not sent for interpretation. Capability testing uses a synthetic image. Current chat still uses selected text or the current page/chapter; whole-document retrieval and image-click conversations are not implemented yet.

Appearance supports light, dark, and system modes, including the desktop window.

## Screenshots

Captured from the app with the bundled sample documents. Images follow GitHub's light / dark appearance.

| Library                                                                                                                                                                                                                                        | Agent settings                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| <picture> <source media="(prefers-color-scheme: dark)" srcset="website/assets/screenshots/library-dark.webp" /> <img src="website/assets/screenshots/library-light.webp" alt="Library with a PDF processing overlay on its cover" /></picture> | <img src="website/assets/screenshots/settings-light.webp" alt="Agent settings with Codex, Claude Code and Kimi Code" /> |

## Quick start

Requires **Node.js 22+, pnpm 10.30.3, and Go 1.26.5+**.

```sh
git clone https://github.com/cynicalight/reader.git
cd reader
pnpm install
pnpm desktop
```

`pnpm desktop` builds the Go service, web interface, and Electron app, then opens the desktop window. The main API listens on a random loopback port and stops when the application closes.

If the Electron binary was not downloaded successfully during installation, run the following command and try again:

```sh
node apps/desktop/node_modules/electron/install.js
```

## Using AI

AI is optional. Local reading, search, and annotations do not require an AI account.

Install the official CLI you want to use and sign in from your terminal:

```sh
# Use Codex
codex login

# Or use Claude Code
claude auth login
```

Open Reader settings, choose a primary Agent, and check the text and image capability results. Successful real requests produce green capability badges and resume waiting PDF image jobs. Text conversations support Codex, Claude Code, and Kimi Code. Reader does not install CLIs, read their credential files, or implement its own OAuth flow. Account permissions, quotas, model availability, and billing depend on the CLI login and the provider. Question answering and translation can use separate models and supported reasoning effort levels in Settings; unspecified models use the recommendations for each task. Older CLI versions may need an upgrade to support the integration's command-line options.

macOS 和 Windows 桌面版启动时读取手动系统代理，并通过环境变量传给 Go 服务和 Agent CLI；没有配置代理或代理关闭时正常直连，本机服务始终保留直连例外。Windows 读取当前用户、当前连接的配置，支持统一 HTTP 代理或按 HTTP/HTTPS 分别配置；同时开启自动发现时使用已配置的手动代理，不执行 WPAD。系统代理变化后需要重启 Reader，并在设置中点击“重新检测 Agent”更新旧检测结果。PAC、仅自动发现、Windows SOCKS 和无法转换的例外规则（如 `<local>`）暂不支持；读取或转换失败会提示并保留原有环境。其他平台保持继承原有环境。

The first PDF analysis downloads and verifies a roughly 67 MB layout model. The cached model locates image regions locally; Python and PaddlePaddle are not required. Without a verified connection, reading and region hover remain available while translation waits for configuration. Processing resumes after restart and reuses saved translations. Scanned pages are explicitly marked incomplete because OCR is not available.

**Using AI sends relevant content off your machine.** Capability tests use a synthetic image. With a verified primary Agent configured, imported PDF body text and captions are sent for translation and formula images for LaTeX conversion. When you request a translation, explanation, summary, or send a question, Reader passes the selected excerpts or current chapter / page context, along with recent conversation history, to the CLI. The CLI then contacts its AI service. Chapter and context lengths are limited; a summary of the current page is not a summary of the entire paper.

CLIs run in temporary empty directories. Claude is configured with tools and MCP disabled. Codex runs in a read-only sandbox with shell tools disabled. Raw CLI logs are not shown as answers. Codex streams text through App Server, Claude uses stream-json, and Kimi uses ACP message chunks. Text and image conversations both forward incremental output. See the [frontend integration contract (Chinese)](docs/agent-streaming-contract.md).

## Local data

Original files are stored on the filesystem. Document metadata, progress, annotations, conversations, and settings are stored in SQLite. Reader has no built-in cloud sync.

| Mode                                | Data directory                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| Installed desktop app               | Electron `userData/library/`; typically `~/Library/Application Support/Reader/library/` on macOS |
| Unpackaged desktop (`pnpm desktop`) | `~/Library/Application Support/Reader Dev/library/` on macOS                                     |
| Browser development (`pnpm dev`)    | `.reader/` in the project root                                                                   |

If you previously used `pnpm desktop` as your daily app, your old library is at `~/Library/Application Support/Reader/library/`. You can copy it to the new directory while Reader is closed.

```text
library/
├── reader.sqlite       # Metadata, reading records, conversations, settings, and full-text index
├── books/              # Original EPUB files
├── papers/             # Original PDF files
├── cache/              # Readium manifests, positions, and processed EPUB resources
└── ai-work/            # Temporary CLI directories, removed after requests finish
```

Close the application before backing up the entire data directory. The local API uses a randomly generated token for each launch and validates Host / Origin. EPUB imports check archive size and resource paths, and sanitize active content. Original files remain unchanged.

## Development

Start the Go service and the web interface with hot reload:

```sh
pnpm dev
```

The terminal prints a URL in the form `http://127.0.0.1:5173/#token=…`. Open the complete URL. Vite proxies requests to the Go service at `127.0.0.1:17840`. This token authenticates access to the local service; it is not an AI account credential. Do not share URLs containing the token.

Development runs leave the connector port disabled unless `READER_DEV_CONNECTOR=1` is set. Unpackaged desktop runs register `reader://` only with `READER_DEV_PROTOCOL=1`.

```sh
pnpm typecheck     # TypeScript type checking
pnpm test          # Go integration tests and Vitest
pnpm build         # Build Go, web, and Electron
pnpm api:generate  # Regenerate client types from OpenAPI
```

The project website lives in `website/` as static HTML, CSS and JavaScript with no build step. Preview it locally with `python3 -m http.server 4321 -d website` and open `http://127.0.0.1:4321/`.

Tests cover document imports, persistence, resource access boundaries, CLI protocols, PDF parsing, and selected frontend regressions. Passing builds and tests does not replace manual checks with real documents and the application UI. See the [verification notes](docs/verification.md) (Chinese).

## Technology and structure

The frontend uses React, TypeScript, Vite, Tailwind CSS, shadcn/ui (Base UI), and Zustand. Electron manages windows, native file selection, and the Go service lifecycle. Go handles local documents, SQLite, search, and AI CLI calls.

```text
apps/
├── desktop/       # Electron main / preload
├── web/           # React UI, PDF.js and Readium reader adapters
└── server/        # Go local service
packages/
├── ui/            # shadcn/ui + Base UI components
├── reader-core/   # Document, Location, TOC, Annotation, ReaderAdapter
└── api-client/    # OpenAPI types and API client
docs/              # Scope, roadmap, API contract, and verification notes
website/           # Static project website and README screenshots
assets/            # Logo sources and app icons
```

The domain model centers on `Document`. PDF positions use page numbers and coordinates; EPUB positions use chapter resources and locators. The reading interface accesses each engine through `ReaderAdapter`. The project uses pnpm workspaces without Nx or Turborepo.

## Current limitations and next steps

The current version primarily targets DRM-free reflowable EPUBs and PDFs with text. OCR, password entry for protected PDFs, PDF thumbnails, background PDF full-text indexing, batch translation, cross-document AI retrieval, independent conversation management, Ollama, API-provider settings UI, and reading statistics are not yet supported. Backend API fallback configuration is available through the local API. Highlights are not created for complex PDF selections spanning multiple pages.

Fixed-layout EPUBs, vertical text, RTL, complex footnotes, and large files need more testing with real documents. The desktop app handles macOS file-open events, but system file associations are not registered. Installers are built by CI without trusted developer signing or macOS notarization. In-app update checks are available; macOS releases signed with the fixed certificate support in-place updates, with installer downloads used in other cases. See the [release and update guide (Chinese)](docs/releasing.md) for requirements.

The next priority is improving the reading experience with real documents, followed by search, data export, and AI features. See the [roadmap](docs/roadmap.md) (Chinese).

## References and acknowledgments

The product interaction design draws on [EasyRead](https://github.com/Edwardxlai/easyread), particularly its local AI reading workflow and CLI account integration. Reader was independently implemented from an empty directory using React / TypeScript and Go.

Thanks to [Readium](https://github.com/readium), [PDF.js](https://github.com/mozilla/pdf.js), [shadcn/ui](https://github.com/shadcn-ui/ui), and [Base UI](https://github.com/mui/base-ui). The shadcn components are included in `packages/ui`; their license is available in [packages/ui/LICENSE.md](packages/ui/LICENSE.md). See [third-party sources](docs/sources.md) (Chinese) for further attribution.

[Project scope](docs/spec.md) · [Roadmap](docs/roadmap.md) · [OpenAPI](docs/openapi.yaml) · [Verification notes](docs/verification.md)

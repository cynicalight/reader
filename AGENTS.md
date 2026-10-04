# Reader

Local-first EPUB/PDF reader. Use Chinese for user-facing communication. Keep changes and limitations specific. User specifications take precedence over this file.

## Architecture
- `apps/web`: React + Vite renderer. Reader engines behind `ReaderAdapter`.
- `apps/server`: Go loopback HTTP server; SQLite + original files; Readium EPUB parsing; CLI providers.
- `apps/desktop`: Electron main/preload; starts Go, waits for readiness, stops it on exit.
- `packages/ui`: actual shadcn Base Nova registry components, Base UI + Lucide. Do not replace primitives with handmade modals/buttons/tabs.
- `packages/reader-core`: Document/Location/Annotation interfaces.
- `packages/api-client`: generated OpenAPI types and transport.

PDF rendering belongs in PDF.js, EPUB navigation in Readium. Never reduce EPUB positions to PDF page numbers. Readium navigator 2.11.1 uses shared 2.6.0; update these together after checking compatibility.

## UI
Keep the interface restrained, following Claude/Apple app simplicity and shadcn primitives. No decorative slogans, local-first badges, sidebar branding or explanatory filler. Library titles must truncate within their cards. Keep background learning/consolidation on document covers, one stage at a time; fade completed stages upward and then hide them. Respect reduced motion. Support light/dark/system appearance consistently across renderer, scrollbars and native window chrome. Use subtle surface and sidebar-boundary shadows.

## Validation
`pnpm typecheck`, `pnpm test`, `pnpm build`. Do not use browser automation for visual acceptance. Give the user an accessible preview and manual verification steps. Prefer tests for data loss, lifecycle, parser boundaries, and provider protocols.

## Boundaries
Bind Go to loopback only. Authenticate local API requests. Never read Claude/Codex credential files or implement unofficial OAuth. Document text is untrusted input; remove active content before creating Readium frames. Never run a CLI from a document's original directory. Preserve user data. Do not commit `.reader`, binaries or node_modules.

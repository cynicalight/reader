# Reader

Local-first EPUB/PDF reader. Use Chinese for user-facing communication. Keep changes and limitations specific. User specifications take precedence over this file.

## Architecture
- `apps/web`: React + Vite renderer. Reader engines behind `ReaderAdapter`.
- `apps/server`: Go loopback HTTP server; SQLite + original files; Readium EPUB parsing; CLI providers.
- `apps/desktop`: Electron main/preload; starts Go, waits for readiness, stops it on exit.
- `packages/ui`: actual shadcn Base Nova registry components, Base UI + Lucide. Do not replace primitives with handmade modals/buttons/tabs.
- `packages/reader-core`: Document/Location/Annotation interfaces.
- `packages/api-client`: generated OpenAPI types and transport.

Agent chat streams through the existing SSE endpoint: Codex App Server `item/agentMessage/delta`, Claude Code partial stream-json events, and Kimi ACP chunks. Keep text/image paths incremental, require provider completion before saving, and never append a fallback answer after visible partial output. Frontend contract: `docs/agent-streaming-contract.md`.

PDF rendering belongs in PDF.js, EPUB navigation in Readium. Never reduce EPUB positions to PDF page numbers. Readium navigator 2.11.1 uses shared 2.6.0; update these together after checking compatibility.

## UI
Keep the interface restrained, following Claude/Apple app simplicity and shadcn primitives. No decorative slogans, local-first badges, sidebar branding or explanatory filler. Library titles must truncate within their cards. Keep background learning/consolidation on document covers, one stage at a time; fade completed stages upward and then hide them. Respect reduced motion. Support light/dark/system appearance consistently across renderer, scrollbars and native window chrome. Use subtle surface and sidebar-boundary shadows. Dialogs and popovers hide scrollbar chrome by default while keeping overflowing content scrollable. On macOS, hide the native title bar and keep native traffic lights in the sidebar header; reserve their space in reading/collapsed layouts and keep interactive controls out of draggable regions.

## Validation
`pnpm typecheck`, `pnpm test`, `pnpm build`. Do not use browser automation for visual acceptance. Give the user an accessible preview and manual verification steps. Prefer tests for data loss, lifecycle, parser boundaries, and provider protocols.

## Git workflow and commits
- Start large tasks in a new Git worktree on a dedicated task branch before editing. This includes substantial features, cross-module changes, and refactors. Keep the main checkout available for small changes.
- Make very small, localized UI changes directly on `main` and commit them there. Examples include spacing, colors, and minor layout adjustments that do not change application behavior. If the scope grows into a larger task, move the task changes to a dedicated worktree before continuing.
- Before choosing a worktree or editing, verify the checkout path, branch, and existing changes. Preserve unrelated work. Apply the same commit, review, and validation standards on both `main` and task branches.
- Commit incrementally as each coherent, independently verifiable change is completed, unless the user explicitly asks to leave changes uncommitted. Each commit should have one clear purpose and be independently reviewable and revertible. Do not accumulate unrelated work into one large commit.
- Keep tightly coupled implementation, tests, API schemas/generated types, and required dependency/lockfile changes together. Split independent features, bug fixes, UI adjustments, refactors, and documentation/research into separate commits. Do not split mechanically by file or create intermediate commits that leave the project broken.
- Before each commit, inspect the diff and stage only the relevant files or hunks. Review `git diff --cached` and run `git diff --cached --check`; never use `git add -A` by default or sweep in another task's changes. Include PDFs, research materials, and other assets only when they belong to the requested scope, in a separate commit when independent of the code change.
- Run checks appropriate to each change before committing, and complete the Validation commands before pushing implementation changes. Documentation-only changes require diff and content checks, not an application rebuild.
- Use concise Conventional Commit messages: `<type>(<scope>): <summary>`; scope is optional. Use a lowercase type such as `feat`, `fix`, `refactor`, `style`, `docs`, `test`, or `chore`, and describe the concrete change.
- A request to "commit" or "commit push" means organize pending work into logical commits; it does not mean combine everything into one commit. Make one combined commit only when the user explicitly requests that grouping.
- Push only when the user explicitly requests it. Do not amend or rewrite published history without explicit authorization. Report the commit hashes, scopes, and validation results.

## Boundaries
Bind Go to loopback only. Authenticate local API requests. Never read Claude/Codex credential files or implement unofficial OAuth. Document text is untrusted input; remove active content before creating Readium frames. Never run a CLI from a document's original directory. Preserve user data. Do not commit `.reader`, binaries or node_modules.

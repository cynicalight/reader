# Local PDF layout and Codex validation

The processor is now connected to the desktop two-stage import UI, with separate progress bars and detected-region hover. Full-document retrieval and image-click conversations remain separate work. The agreed workflow is in [reading-workflow.md](reading-workflow.md).

## Distribution decision

The planned default installer includes PDF.js, the native Canvas runtime, ONNX Runtime and the processor code. The PP-DocLayoutV3 weights are downloaded automatically on first use and cached once per local library. Users do not install Python or PaddlePaddle. An installer containing the weights could support offline first use; that packaging variant is not implemented.

The desktop import flow now starts the worker automatically for PDFs. The UI exposes model download status, per-page learning progress, translation progress, connection waits and retries. Per-asset image consolidation has since been removed; the consolidation results below are a historical record. Desktop installer distribution is not implemented yet.

Weights: `PaddlePaddle/PP-DocLayoutV3_onnx`, revision `46bbdf188bb0a772c08aed74882ce7e51a8f1ea6`, 130,502,049 bytes (about 130 MB / 124.5 MiB). SHA256: `45bf71750b00739a41fc209f132eb104a4d6b5bb29483c9078164d8b87cf28ba`. Weights and generated user documents are not committed. The download is checked before inference; partial downloads never become the cached model.

Sources: [official model card](https://huggingface.co/PaddlePaddle/PP-DocLayoutV3_onnx), [pinned configuration](https://huggingface.co/PaddlePaddle/PP-DocLayoutV3_onnx/blob/46bbdf188bb0a772c08aed74882ce7e51a8f1ea6/inference.yml), [PaddleX postprocessing](https://github.com/PaddlePaddle/PaddleX/blob/develop/paddlex/inference/models/object_detection/processors.py). Model license: Apache-2.0; retain the upstream license and notices when distributing weights.

## Reproduce

```sh
pnpm --filter @reader/processor build
node apps/processor/dist/main.mjs \
  --input 'docs/66_VLDB25- Oze_ Decentralized Graph-based Concurrency Control for Long-running Update Transactions.pdf' \
  --output .reader/layout-check/oze \
  --model-cache .reader/models \
  --debug
```

Use a fresh output directory for each run. `--model FILE` accepts an already-downloaded copy, still checked against the pinned hash. Without `--debug`, full-page and diagnostic images are not saved. `manifest.json` is written last and records source hash, page count, normalized coordinates, model revision, timing and warnings. `paper.md` references crops in `assets/`. The sample PDF is supplied locally by the user and is not distributed in this repository.

Opt-in real Codex test (uses the existing CLI login and subscription):

```sh
cd apps/server
READER_TEST_CODEX=1 go test ./internal/reader -run '^TestLiveCodex$' -v -count=1
```

The default automated test suite skips this call. To additionally test a paper image, set `READER_TEST_IMAGE` to its absolute PNG path and optionally `READER_TEST_OUTPUT` to a Markdown destination. The test runs in a fresh temporary working directory, disables shell tools and avoids user/project instruction configuration. It uses the CLI's authentication; Reader does not inspect credentials.

## Observations on 2026-10-04

The supplied Oze paper has 13 pages. All pages rendered and underwent local CPU inference in approximately 17 seconds on the development Mac (including diagnostic PNG output, excluding model download/startup and AI calls). Observed process peak RSS was about 1.3 GB; this is a prototype measurement, not a system requirement or a guarantee for other hardware.

The first rendering attempt crashed because PDF.js and the processor loaded different native Canvas versions. Using the same `@napi-rs/canvas` version as PDF.js fixed the crash on this fixture. Keep those native object implementations aligned when updating dependencies.

The raw detector returned 85 inline formula regions. Those remain in paragraph text instead of creating dozens of tiny images. Separate figures with one numbered caption are grouped into a whole block, including captions and subfigure labels. Independent neighboring figures must not merge. Regression tests cover these boundaries, invalid coordinates, duplicate detections and retained unmatched text.

Codex passed an actual text invocation and an eight-tile randomized visual challenge. An automatically cropped Figure 2 also produced a Chinese Markdown transcript. This verifies the image transport and a real paper-image response; it does not validate every relation or figure in the paper.

## Desktop processing integration check

The Oze fixture completed the real import → learning → waiting for configuration → consolidation → ready sequence in an isolated library. The worker ran through the Electron executable with `ELECTRON_RUN_AS_NODE=1`. All 13 pages were processed, 17 image blocks were available before vision finished, and all 17 nonempty Markdown transcripts were saved using the locally authenticated Codex CLI.

After the first transcript was saved, the Go service was stopped and restarted. Processing resumed, and hashes confirmed that previously completed transcripts were unchanged. This checks transport, persistence and lifecycle behavior; transcript factual accuracy has not been reviewed exhaustively.

Validation passed: `pnpm typecheck`, `pnpm test` (Go suite and 23 Vitest tests), `pnpm build`, plus targeted Go race tests for queue recovery, capability wake-up, transcript preservation and the library lock. Native Electron inspection observed separate progress bars during learning and Figure 1 region hover. The final rebuild was launched successfully; a subsequent screenshot attempt was blocked by a macOS capture error.

## Remaining limits

- One paper is not enough to establish layout accuracy; this fixture does not establish table detection quality.
- Some captions and standalone formula boundaries are incomplete. Caption grouping is heuristic and needs a wider fixture set. Do not present model confidence as measured accuracy.
- Extracted formula text is not reliable mathematical transcription. Use the original image and vision transcript; retain source coordinates.
- Reading order follows detector output. Heading levels are provisional; paragraphs crossing pages and nested subsections are not fully reconstructed.
- The worker does not perform OCR. Pages without extractable text are explicitly marked incomplete.
- Resume, per-asset vision jobs, atomic transcript publication, two-stage UI, hover and desktop worker lifecycle are integrated. Whole-document retrieval, citation navigation and conversation-driven revisions remain work under the wider plan.
- Native Electron inspection confirmed separate progress bars and Figure 1 hover alignment on the supplied paper. No browser automation was used. This is a scoped check, not cross-platform or comprehensive visual acceptance.

## Library presentation update

The library now truncates long titles inside a shrinkable grid cell, removes decorative branding/copy, and uses a subtly raised main surface. Light/dark/system appearance is persisted with reading preferences and synchronized to Electron native chrome; live system changes are covered by a renderer hook test. PDF processing appears on covers one stage at a time, with a completion transition and no persistent reading-toolbar progress strip. Waiting/retry actions remain accessible on the cover.

`pnpm typecheck`, `pnpm test` (27 Vitest tests plus Go), and `pnpm build` passed for this update. Native screenshot capture returned a macOS ScreenCaptureKit error, so the updated appearance and title layout require manual visual verification in the relaunched Electron app. Check the long Oze title, all three appearance choices, and cover-stage transitions during an import.

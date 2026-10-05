// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { PDFPageProxy } from "pdfjs-dist";
import type { PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { PDFBlock, TranslationBlock } from "@reader/core";
vi.mock("pdfjs-dist", () => ({
  Util: { transform: (_a: number[], b: number[]) => b },
}));
import { PDFReadingNavigation } from "./pdf-navigation";

it("does not apply delayed column detection after manual zoom or leaving parallel mode", async () => {
  const host = document.createElement("div");
  let release!: (p: PDFPageProxy) => void;
  const page = new Promise<PDFPageProxy>((resolve) => {
    release = resolve;
  });
  const viewer = {
    currentPageNumber: 1,
    currentScaleValue: "1.7",
    getPageView: () => undefined,
  } as unknown as PDFViewer;
  const fitted = vi.fn();
  const nav = new PDFReadingNavigation(
    host,
    viewer,
    () => page,
    () => 1,
    () => [],
    { location: vi.fn(), selection: vi.fn(), columnFit: fitted },
  );
  const pending = nav.fit();
  nav.stop();
  release({
    getViewport: () => ({ width: 600, height: 800, transform: [] }),
    getTextContent: async () => ({ items: [], styles: {} }),
  } as unknown as PDFPageProxy);
  await pending;
  expect(viewer.currentScaleValue).toBe("1.7");
  expect(nav.fitted).toBe(false);
  expect(fitted).not.toHaveBeenCalledWith(true);
  nav.destroy();
});
it("uses selected glyph positions to distinguish repeated words and includes both paragraphs", async () => {
  const host = document.createElement("div"),
    page = document.createElement("div");
  host.append(page);
  page.innerHTML =
    '<div class="textLayer"><span>The model works. </span><span>The model works.</span><span>Next paragraph.</span></div>';
  const spans = page.querySelectorAll("span");
  page.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 1000);
  spans.forEach((s, i) => {
    s.getBoundingClientRect = () => new DOMRect(100, 100 + i * 30, 300, 20);
  });
  const old = Range.prototype.getClientRects;
  Range.prototype.getClientRects = function () {
    const index = Array.from(spans).indexOf(
      this.startContainer.parentElement as HTMLSpanElement,
    );
    return [
      new DOMRect(100, 100 + index * 30, 300, 20),
    ] as unknown as DOMRectList;
  };
  try {
    const blocks: PDFBlock[] = [
      {
        id: "a",
        page: 1,
        label: "text",
        text: "The model works. The model works.",
        bounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.06 },
      },
      {
        id: "b",
        page: 1,
        label: "text",
        text: "Next paragraph.",
        bounds: { x: 0.1, y: 0.16, width: 0.3, height: 0.03 },
      },
    ];
    const translations: TranslationBlock[] = [
      {
        blockId: "a",
        sourceHash: "a",
        status: "complete",
        sentences: [
          { source: "The model works.", target: "模型有效。" },
          { source: "The model works.", target: "模型有效。" },
        ],
      },
      {
        blockId: "b",
        sourceHash: "b",
        status: "complete",
        sentences: [{ source: "Next paragraph.", target: "下一段。" }],
      },
    ];
    const nav = new PDFReadingNavigation(
      host,
      { getPageView: () => ({ div: page }) } as unknown as PDFViewer,
      async () =>
        ({
          getViewport: () => ({ width: 1000, height: 1000, transform: [] }),
          getTextContent: async () => ({ items: [], styles: {} }),
        }) as unknown as PDFPageProxy,
      () => 1,
      () => blocks,
      { location: vi.fn(), selection: vi.fn() },
    );
    expect(
      await nav.matchSentences(
        {
          type: "pdf",
          page: 1,
          rects: [{ x: 0.15, y: 0.105, width: 0.05, height: 0.01 }],
        },
        translations,
      ),
    ).toEqual([{ blockId: "a", sentenceIndexes: [0] }]);
    expect(
      await nav.matchSentences(
        {
          type: "pdf",
          page: 1,
          rects: [
            { x: 0.15, y: 0.135, width: 0.05, height: 0.01 },
            { x: 0.15, y: 0.165, width: 0.05, height: 0.01 },
          ],
        },
        translations,
      ),
    ).toEqual([
      { blockId: "a", sentenceIndexes: [1] },
      { blockId: "b", sentenceIndexes: [0] },
    ]);
    await nav.focusPassages([
      { blockId: "a", sources: ["The model works."], sourceOffset: 14 },
    ]);
    const highlighted = page.querySelector<HTMLElement>(
      ".reader-linked-highlight",
    )!;
    expect(highlighted.style.top).toBe("13%");
    nav.destroy();
  } finally {
    Range.prototype.getClientRects = old;
  }
});

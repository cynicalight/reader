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
    // Sentence focusing is exercised through native highlight ranges in
    // pdf-sentence-highlights.test.ts; it no longer appends page rectangles.
    expect(page.querySelector(".reader-linked-highlight")).toBeNull();
    nav.destroy();
  } finally {
    Range.prototype.getClientRects = old;
  }
});

it("keeps zoom fixed while following mixed layouts and skips furniture-only pages in both directions", async () => {
  const host = document.createElement("div");
  Object.defineProperties(host, {
    clientWidth: { value: 600 },
    clientHeight: { value: 600 },
  });
  host.getBoundingClientRect = () => new DOMRect(0, 0, 600, 600);
  let scale = 1;
  const pageWrites: number[] = [];
  const currentPage = () =>
    Math.min(3, Math.floor((host.scrollTop + 600) / 2000) + 1);
  const scaleWrites: number[] = [];
  const nodes = [1, 2, 3].map((n) => {
    const node = document.createElement("div");
    node.getBoundingClientRect = () =>
      new DOMRect(
        -host.scrollLeft,
        (n - 1) * 2000 - host.scrollTop,
        1000,
        1000,
      );
    return node;
  });
  const viewer = {
    get currentPageNumber() {
      return currentPage();
    },
    set currentPageNumber(n: number) {
      pageWrites.push(n);
    },
    get currentScale() {
      return scale;
    },
    set currentScaleValue(s: string) {
      scale = Number(s);
      scaleWrites.push(scale);
    },
    getPageView: (n: number) => ({ div: nodes[n] }),
  } as unknown as PDFViewer;
  const body = (x: number, width: number) =>
    Array.from({ length: 12 }, (_, i) => ({
      str: `Body line ${i}`,
      width,
      fontName: "f",
      transform: [1, 0, 0, 20, x, 216 + i * 40],
    }));
  const blocks: PDFBlock[] = [
    {
      id: "left",
      page: 1,
      label: "text",
      text: "Left body",
      bounds: { x: 0.08, y: 0.2, width: 0.37, height: 0.46 },
    },
    {
      id: "right",
      page: 1,
      label: "text",
      text: "Right body",
      bounds: { x: 0.55, y: 0.2, width: 0.37, height: 0.46 },
    },
    {
      id: "footer",
      page: 2,
      label: "footer",
      text: "12",
      bounds: { x: 0.48, y: 0.95, width: 0.04, height: 0.02 },
    },
    {
      id: "single",
      page: 3,
      label: "text",
      text: "Single body",
      bounds: { x: 0.15, y: 0.2, width: 0.7, height: 0.46 },
    },
  ];
  const page = vi.fn(
    async (n: number) =>
      ({
        getViewport: () => ({ width: 1000, height: 1000, transform: [] }),
        getTextContent: async () => ({
          styles: {},
          items:
            n === 1
              ? [
                  {
                    str: "Journal heading",
                    width: 800,
                    fontName: "f",
                    transform: [1, 0, 0, 20, 100, 56],
                  },
                  ...body(80, 370),
                  ...body(550, 370),
                ]
              : n === 2
                ? [
                    {
                      str: "12",
                      width: 40,
                      fontName: "f",
                      transform: [1, 0, 0, 20, 480, 966],
                    },
                  ]
                : body(150, 700),
        }),
      }) as unknown as PDFPageProxy,
  );
  const nav = new PDFReadingNavigation(
    host,
    viewer,
    page,
    () => 3,
    () => blocks,
    { location: vi.fn(), selection: vi.fn() },
  );
  try {
    await nav.fit();
    expect(scaleWrites).toEqual([1.5]);
    // Seeing the end near the viewport bottom must not advance the column.
    host.scrollTop = 80; // column bottom: 660 - 80 = 580, viewport midpoint: 300
    const earlyWheel = new WheelEvent("wheel", {
      deltaY: 100,
      cancelable: true,
    });
    host.dispatchEvent(earlyWheel);
    expect(earlyWheel.defaultPrevented).toBe(false);
    host.scrollTop = 360; // column bottom now reaches the midpoint
    const boundaryWheel = new WheelEvent("wheel", {
      deltaY: 100,
      cancelable: true,
    });
    host.dispatchEvent(boundaryWheel);
    expect(boundaryWheel.defaultPrevented).toBe(true);
    await nav.follow({ blockId: "left", fraction: 1 });
    // Classification arrives after the initial header/left/right geometry.
    blocks.push({
      id: "header",
      page: 1,
      label: "header",
      text: "Journal heading",
      bounds: { x: 0.1, y: 0.04, width: 0.8, height: 0.02 },
    });
    await nav.fit(false);
    host.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 100, cancelable: true }),
    );
    await vi.waitFor(() => expect(host.scrollLeft).toBeGreaterThan(500));
    expect(currentPage()).toBe(1);
    await new Promise((r) => setTimeout(r, 200));
    await nav.follow({ blockId: "right", fraction: 1 });
    expect(scaleWrites).toEqual([1.5]);
    // At the right-column bottom, scroll to the next readable page.
    host.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 100, cancelable: true }),
    );
    await vi.waitFor(() => expect(currentPage()).toBe(3));
    await vi.waitFor(() => expect(host.scrollTop).toBeGreaterThan(4000));
    expect(scaleWrites).toEqual([1.5]);
    await nav.fit(false); // resizing / explicit page navigation only repositions
    expect(scaleWrites).toEqual([1.5]);
    await nav.follow({ blockId: "single", fraction: 0 });
    await new Promise((r) => setTimeout(r, 200));
    host.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -100, cancelable: true }),
    );
    await vi.waitFor(() => expect(currentPage()).toBe(1));
    await vi.waitFor(() => expect(host.scrollTop).toBeLessThan(2000));
    expect(scaleWrites).toEqual([1.5]);
    nav.stop();
    scale = 1.75;
    await nav.follow({ blockId: "single", fraction: 0.5 });
    expect(scale).toBe(1.75);
    expect(nav.fitted).toBe(false);
    expect(pageWrites).toEqual([]);
    expect(scaleWrites).toEqual([1.5]);
  } finally {
    nav.destroy();
  }
});

it("cancels an in-flight page move on pointer input without reporting the destination as reached", async () => {
  const host = document.createElement("div"),
    node = document.createElement("div");
  host.getBoundingClientRect = () => new DOMRect(0, 0, 600, 600);
  node.getBoundingClientRect = () =>
    new DOMRect(0, 1200 - host.scrollTop, 800, 1000);
  const nav = new PDFReadingNavigation(
    host,
    { getPageView: () => ({ div: node }) } as unknown as PDFViewer,
    vi.fn(),
    () => 2,
    () => [],
    { location: vi.fn(), selection: vi.fn() },
  );
  try {
    const pending = nav.goTo(2);
    await vi.waitFor(() => expect(host.scrollTop).toBeGreaterThan(0));
    expect(host.scrollTop).toBeLessThan(1176);
    host.dispatchEvent(new MouseEvent("pointerdown"));
    host.scrollTop = 42;
    expect(await pending).toBe(false);
    expect(host.scrollTop).toBe(42);
    expect(await nav.goTo(2)).toBe(true);
    expect(host.scrollTop).toBe(1176);
  } finally {
    nav.destroy();
  }
});

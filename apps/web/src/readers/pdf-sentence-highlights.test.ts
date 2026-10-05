// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PDFPageProxy } from "pdfjs-dist";
import type { PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { PDFBlock, TranslationBlock } from "@reader/core";
import { translatedSelection } from "../translation/selection";
vi.mock("pdfjs-dist", () => ({
  Util: { transform: (_a: number[], b: number[]) => b },
}));
import { PDFReadingNavigation } from "./pdf-navigation";

let host: HTMLDivElement, page: HTMLDivElement, nav: PDFReadingNavigation;
let registry: Map<string, Set<Range>>;
const block: PDFBlock = {
  id: "paragraph",
  page: 1,
  label: "text",
  text: "Before. The function add_target_records() identifies the records. It first retrieves all followers. After.",
  bounds: { x: 0.1, y: 0.1, width: 0.8, height: 0.3 },
};
const sources = [
  "Before.",
  "The function add_target_records() identifies the records.",
  "It first retrieves all followers.",
  "After.",
];
function textLayer() {
  page.innerHTML =
    '<div class="textLayer"><span>Before. The function </span><span>add_target_records()</span><span> identifies the records. It first retrieves all followers. After.</span></div>';
  page.querySelectorAll("span").forEach((span, i) => {
    span.getBoundingClientRect = () => new DOMRect(100, 100 + i * 30, 800, 20);
  });
}
const markedText = () =>
  [...registry.values()].flatMap((h) => [...h].map((r) => r.toString()));
beforeEach(() => {
  registry = new Map();
  vi.stubGlobal("CSS", { highlights: registry });
  vi.stubGlobal(
    "Highlight",
    class extends Set<Range> {
      constructor(...ranges: Range[]) {
        super(ranges);
      }
    },
  );
  host = document.createElement("div");
  page = document.createElement("div");
  host.append(page);
  document.body.append(host);
  page.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 1000);
  textLayer();
  vi.stubGlobal("requestAnimationFrame", vi.fn());
  nav = new PDFReadingNavigation(
    host,
    { getPageView: () => ({ div: page }) } as unknown as PDFViewer,
    async () =>
      ({
        getViewport: () => ({ width: 1000, height: 1000, transform: [] }),
        getTextContent: async () => ({ items: [], styles: {} }),
      }) as unknown as PDFPageProxy,
    () => 1,
    () => [block],
    { location: vi.fn(), selection: vi.fn() },
  );
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [new DOMRect(100, 100, 800, 20)],
  });
});
afterEach(() => {
  nav.destroy();
  host.remove();
  window.getSelection()?.removeAllRanges();
  delete (Range.prototype as Partial<Range>).getClientRects;
  vi.unstubAllGlobals();
});

it("highlights whole source sentences for a partial translation selection using text ranges, preserving the native selection", async () => {
  const translation = document.createElement("div");
  translation.innerHTML =
    '<section data-translation-block="paragraph"><span data-sentence="0">之前。</span><span data-sentence="1">函数确定目标记录。</span><span data-sentence="2">它首先获取所有后继事务。</span><span data-sentence="3">之后。</span></section>';
  host.append(translation);
  const sentences = translation.querySelectorAll("span");
  const range = document.createRange();
  range.setStart(sentences[1].firstChild!, 2);
  range.setEnd(sentences[2].firstChild!, 4);
  Object.assign(range, {
    getBoundingClientRect: () => new DOMRect(0, 0, 100, 20),
  });
  window.getSelection()!.addRange(range);
  const translations: TranslationBlock[] = [
    {
      blockId: block.id,
      sourceHash: "hash",
      status: "complete",
      sentences: sources.map((source, i) => ({
        source,
        target: sentences[i].textContent!,
      })),
    },
  ];
  const value = translatedSelection(translation, range, [block], translations)!;
  await nav.focusPassages(value.passages);
  expect(markedText()).toEqual(sources.slice(1, 3));
  expect(window.getSelection()!.getRangeAt(0)).toBe(range);
  expect(window.getSelection()!.toString()).toBe("确定目标记录。它首先获");
  expect(page.querySelector(".reader-linked-highlight")).toBeNull();
});

it("never paints a paragraph rectangle for an unmatched sentence and keeps other matched sentences", async () => {
  await nav.focusPassages([
    { blockId: block.id, sources: ["Unavailable sentence.", sources[2]] },
  ]);
  expect(page.querySelector(".reader-linked-highlight")).toBeNull();
  expect(markedText()).toEqual([sources[2]]);
});

it("replaces ranges after text layer rebuild and clears them on dismissal and disposal", async () => {
  const passages = [{ blockId: block.id, sources: [sources[1]] }];
  await nav.focusPassages(passages);
  const oldRange = [...registry.values()][0]?.values().next().value;
  expect(oldRange).toBeDefined();
  textLayer();
  nav.repaint();
  nav.repaint();
  expect(markedText()).toEqual([sources[1]]);
  const current = [...registry.values()][0].values().next().value!;
  expect(current.startContainer.isConnected).toBe(true);
  expect(current).not.toBe(oldRange);
  await nav.focusPassages([]);
  expect(registry.size).toBe(0);
  nav.repaint();
  expect(registry.size).toBe(0);
  await nav.focusPassages(passages);
  nav.destroy();
  expect(registry.size).toBe(0);
});

it("waits for a text layer instead of displaying approximate boxes", async () => {
  page.innerHTML = "";
  await nav.focusPassages([{ blockId: block.id, sources: [sources[1]] }]);
  expect(markedText()).toEqual([]);
  expect(page.querySelector(".reader-linked-highlight")).toBeNull();
  textLayer();
  nav.repaint();
  expect(markedText()).toEqual([sources[1]]);
});

it("anchors a repeated sentence by source offset and excludes interleaved text from another column", async () => {
  page.innerHTML =
    '<div class="textLayer"><span>Same.</span><span>Same </span><span>Other column.</span><span>sentence.</span></div>';
  const spans = page.querySelectorAll("span");
  spans.forEach((span, i) => {
    span.getBoundingClientRect = () =>
      new DOMRect(i === 2 ? 950 : 100, 100 + i * 20, 40, 15);
  });
  await nav.focusPassages([
    { blockId: block.id, sources: ["Same sentence."], sourceOffset: 5 },
  ]);
  expect(markedText()).toEqual(["Same", "sentence."]);
});

it("distinguishes identical sentences by source offset", async () => {
  page.querySelectorAll("span").forEach((span) => {
    span.textContent = "Same.";
  });
  await nav.focusPassages([
    { blockId: block.id, sources: ["Same."], sourceOffset: 5 },
  ]);
  const range = [...registry.values()][0].values().next().value!;
  expect(range.startContainer).toBe(
    page.querySelectorAll("span")[1].firstChild,
  );
  expect(markedText()).toEqual(["Same."]);
});

it("matches the three Oze sentences across PDF line fragments, italic code and a subscript", async () => {
  const lines = [
    "MVSG approach.",
    "If the transaction successfully chooses the version order, it then",
    "merges the record-local graph into the transaction-local graph after",
    "checking the follower transactions to identify the target records (",
    "𝑋",
    "𝑖",
    "defined in Section 3.1) to be merged later (Lines 6–7). The function",
    "add_target_ records()",
    " ",
    "in Lines 39–43 illustrates how a transaction",
    "identifies the target records. It first retrieves all followers (Line 40)",
    "and adds each record in the follower’s read set to the target list",
    "(Lines 41–43). Note that followers in the read phase can be ignored",
  ];
  const sentences = [
    "If the transaction successfully chooses the version order, it then merges the record-local graph into the transaction-local graph after checking the follower transactions to identify the target records ( 𝑋 𝑖 defined in Section 3.1) to be merged later (Lines 6–7).",
    "The function add_target_ records() in Lines 39–43 illustrates how a transaction identifies the target records.",
    "It first retrieves all followers (Line 40) and adds each record in the follower’s read set to the target list (Lines 41–43).",
  ];
  const layer = page.querySelector(".textLayer")!;
  layer.replaceChildren(
    ...lines.map((line, i) => {
      const span = document.createElement("span");
      span.textContent = line;
      span.getBoundingClientRect = () =>
        new DOMRect(100, 100 + i * 15, 800, 10);
      return span;
    }),
  );
  await nav.focusPassages([
    { blockId: block.id, sources: sentences, sourceOffset: 13 },
  ]);
  const normalized = (s: string) => s.replace(/\s/g, "");
  expect(markedText().map(normalized)).toEqual(sentences.map(normalized));
});

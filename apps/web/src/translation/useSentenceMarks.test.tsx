// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  Annotation,
  PDFBlock,
  ReaderAdapter,
  TranslationBlock,
} from "@reader/core";
// Geometry/lifecycle assertions are independent of the composited hover renderer.
vi.mock("./sentence-hover", () => ({
  SentenceHover: class {
    invalidate() {}
    show(_key: string, ranges: Range[]) {
      CSS.highlights.set("test-hover", new Highlight(...ranges));
    }
    clear() {
      CSS.highlights.delete("test-hover");
    }
    destroy() {
      this.clear();
    }
  },
}));
import { useSentenceMarks } from "./useSentenceMarks";
import { sentenceLink } from "./sentence-links";
const t: TranslationBlock = {
  blockId: "p1-b1",
  sourceHash: "hash",
  status: "complete",
  sentences: [{ source: "Original sentence.", target: "翻译句子。" }],
};
const blocks = [
  { id: t.blockId, page: 1, bounds: { x: 0, y: 0, width: 1, height: 1 } },
] as PDFBlock[];
const events = { location: vi.fn(), selection: vi.fn(), annotation: vi.fn() };
let host: HTMLDivElement, root: Root;
const registry = new Map<string, Set<Range>>();
const box = (x: number) => new DOMRect(x, 0, 100, 20);
const engine = {
  sentenceRanges: () => {
    const range = document.createRange();
    range.selectNodeContents(host.querySelector("[data-source]")!.firstChild!);
    return [range];
  },
} as unknown as ReaderAdapter;
function App({
  linked = true,
  annotations = [],
  translations = [t],
}: {
  linked?: boolean;
  annotations?: Annotation[];
  translations?: TranslationBlock[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  useSentenceMarks(
    ref,
    engine,
    blocks,
    translations,
    annotations,
    linked,
    "parallel",
    events,
  );
  return (
    <div ref={ref}>
      <div className="page" data-page-number="1">
        <div className="textLayer">
          <span data-source>Original sentence.</span>
        </div>
      </div>
      <section data-translation-block="p1-b1">
        <div data-sentence="0">翻译句子。</div>
      </section>
    </div>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "Highlight",
    class extends Set<Range> {
      priority = 0;
      constructor(...ranges: Range[]) {
        super(ranges);
      }
    },
  );
  vi.stubGlobal("CSS", { highlights: registry });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      return box(this.closest("[data-translation-block]") ? 200 : 0);
    },
  );
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: function (this: Range) {
      const el =
        this.startContainer.nodeType === 3
          ? this.startContainer.parentElement
          : (this.startContainer as Element);
      return [box(el?.closest("[data-translation-block]") ? 200 : 0)];
    },
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: function (this: Range) {
      return this.getClientRects()[0];
    },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  registry.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  events.annotation.mockClear();
  window.getSelection()?.removeAllRanges();
});
const hover = () =>
  [...registry.entries()].find(([name]) => name.endsWith("-hover"))?.[1];
const texts = (ranges: Set<Range> | undefined) =>
  [...(ranges ?? [])].map((r) => r.toString());
async function pointer(selector: string, type: string, x: number, buttons = 0) {
  await act(async () => {
    host.querySelector(selector)!.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        clientX: x,
        clientY: 5,
        buttons,
        button: 0,
      }),
    );
    await vi.advanceTimersByTimeAsync(425);
  });
}
it("highlights both sentence texts in either direction, clears on drag, and keeps native selection untouched", async () => {
  await act(async () => root.render(<App />));
  await pointer("[data-source]", "pointermove", 10);
  expect(texts(hover())).toEqual(["Original sentence.", "翻译句子。"]);
  await pointer("[data-sentence]", "pointermove", 210);
  expect(texts(hover())).toEqual(["Original sentence.", "翻译句子。"]);
  expect(window.getSelection()?.toString()).toBe("");
  await pointer("[data-sentence]", "pointerdown", 210, 1);
  expect(hover()).toBeUndefined();
});
it("disabling association preserves local hover and translated marks, then re-enables the counterpart", async () => {
  const annotation: Annotation = {
    id: "a",
    documentId: "doc",
    kind: "underline",
    quote: "翻译",
    note: "note",
    color: "#5b9fe8",
    createdAt: "",
    location: {
      type: "pdf",
      page: 1,
      translation: {
        blockId: t.blockId,
        sourceHash: t.sourceHash,
        sentenceIndexes: [0],
        start: 0,
        end: 2,
      },
      sentenceLink: sentenceLink(
        [{ blockId: t.blockId, sentenceIndexes: [0] }],
        [t],
        "translation",
      ),
    },
  };
  await act(async () =>
    root.render(<App linked={false} annotations={[annotation]} />),
  );
  await pointer("[data-sentence]", "pointermove", 210);
  expect(texts(hover())).toEqual(["翻译句子。"]);
  let mark = [...registry.entries()].find(([name]) =>
    name.includes("-underline-"),
  )!;
  expect(texts(mark[1])).toEqual(["翻译"]);
  await act(async () => root.render(<App annotations={[annotation]} />));
  mark = [...registry.entries()].find(([name]) =>
    name.includes("-underline-"),
  )!;
  expect(texts(mark[1])).toEqual(["翻译", "Original sentence."]);
  expect(document.head.textContent).toContain("underline 2px #5b9fe8");
  await pointer("[data-source]", "pointerdown", 10, 1);
  await pointer("[data-source]", "click", 10);
  expect(events.annotation).toHaveBeenCalledWith(
    expect.objectContaining({ ids: ["a"] }),
  );
  await act(async () => root.render(<App annotations={[]} />));
  expect(
    [...registry.keys()].some((name) => name.includes("-underline-")),
  ).toBe(false);
});
it("projects a source note onto the complete translated sentence and removes stale projections", async () => {
  const a: Annotation = {
    id: "a",
    documentId: "doc",
    kind: "note",
    quote: "Original",
    note: "note",
    color: "#6cc58c",
    createdAt: "",
    location: {
      type: "pdf",
      page: 1,
      sentenceLink: sentenceLink(
        [{ blockId: t.blockId, sentenceIndexes: [0] }],
        [t],
        "source",
      ),
    },
  };
  await act(async () => root.render(<App annotations={[a]} />));
  expect(texts([...registry.values()][0])).toEqual(["翻译句子。"]);
  await act(async () =>
    root.render(
      <App
        annotations={[a]}
        translations={[{ ...t, sourceHash: "changed" }]}
      />,
    ),
  );
  expect(registry.size).toBe(0);
});

it("keeps a stationary hover after a child mutation and a parent render", async () => {
  await act(async () => root.render(<App />));
  await pointer("[data-sentence]", "pointermove", 210);
  expect(texts(hover())).toEqual(["Original sentence.", "翻译句子。"]);
  await act(async () => {
    host.querySelector(".page")!.append(document.createElement("i"));
    await vi.advanceTimersByTimeAsync(50);
  });
  expect(texts(hover())).toEqual(["Original sentence.", "翻译句子。"]);
  await act(async () => root.render(<App translations={[{ ...t }]} />));
  expect(texts(hover())).toEqual(["Original sentence.", "翻译句子。"]);
});

it("coalesces pointer bursts and ignores block-overlay mutations without rematching PDF text", async () => {
  const matching = vi.spyOn(engine, "sentenceRanges");
  const reads = vi.spyOn(Range.prototype, "getClientRects");
  await act(async () => root.render(<App />));
  await pointer("[data-sentence]", "pointermove", 210);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(40);
  });
  const before = matching.mock.calls.length;
  reads.mockClear();
  await act(async () => {
    for (let i = 0; i < 30; i++)
      host.querySelector("[data-sentence]")!.dispatchEvent(
        new MouseEvent("pointermove", {
          bubbles: true,
          clientX: 210 + i / 100,
          clientY: 5,
        }),
      );
    await vi.advanceTimersByTimeAsync(40);
  });
  expect(reads).not.toHaveBeenCalled();
  await act(async () => {
    const overlay = document.createElement("div");
    overlay.className = "reader-block-hover";
    host.querySelector(".page")!.append(overlay);
    await vi.advanceTimersByTimeAsync(40);
  });
  expect(matching.mock.calls.length).toBe(before);
  await act(async () => {
    host.querySelector("[data-source]")!.textContent = "Original sentence.";
    await vi.advanceTimersByTimeAsync(40);
  });
  expect(matching.mock.calls.length).toBe(before + 1);
  expect(texts(hover())).toEqual(["Original sentence.", "翻译句子。"]);
});

it("waits for dwell, tolerates line gaps, and cancels pending work on interruption", async () => {
  await act(async () => root.render(<App />));
  const matching = vi.spyOn(engine, "sentenceRanges");
  const send = (x: number, type = "pointermove") =>
    host.querySelector("[data-source]")!.dispatchEvent(
      new MouseEvent(type, { bubbles: true, clientX: x, clientY: 5 }),
    );
  const advance = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  send(10);
  await advance(399);
  send(10, "pointerleave");
  await advance(600);
  expect(matching).not.toHaveBeenCalled();
  expect(hover()).toBeUndefined();
  send(10);
  await advance(200);
  send(12);
  await act(async () => root.render(<App translations={[{ ...t }]} />));
  await advance(199);
  expect(matching).not.toHaveBeenCalled();
  expect(hover()).toBeUndefined();
  await advance(1);
  expect(hover()).toBeDefined();
  expect(matching).toHaveBeenCalledTimes(1);
  // Whitespace starts a single leave deadline; repeated moves do not extend it.
  send(150);
  await advance(300);
  send(160);
  await advance(199);
  expect(hover()).toBeDefined();
  send(12);
  await advance(600);
  expect(hover()).toBeDefined();
  send(150);
  await advance(499);
  expect(hover()).toBeDefined();
  await advance(1);
  expect(hover()).toBeUndefined();
  send(10);
  await advance(399);
  send(10, "pointerdown");
  await advance(600);
  expect(hover()).toBeUndefined();
  send(10);
  await advance(400);
  expect(hover()).toBeDefined();
  send(10, "scroll");
  expect(hover()).toBeUndefined();
  send(10);
  send(10, "pointerleave");
  await advance(600);
  expect(hover()).toBeUndefined();
});

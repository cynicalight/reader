// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  defaultTheme,
  type Document,
  type PDFBlock,
  type ReaderAdapter,
  type ReaderEvents,
  type ReaderTheme,
  type TranslationBlock,
} from "@reader/core";
const fixture = vi.hoisted(() => ({
  events: undefined as ReaderEvents | undefined,
  ready: undefined as ReaderAdapter | undefined,
  translations: [] as TranslationBlock[],
  push: undefined as
    | ((
        event:
          | { event: "snapshot"; data: TranslationBlock[] }
          | { event: "translation"; data: TranslationBlock },
      ) => void)
    | undefined,
  signal: undefined as AbortSignal | undefined,
}));
vi.mock("@reader/api", () => ({
  api: {
    assistance: vi.fn(async () => undefined),
    translationStream: vi.fn(
      async (
        _id: string,
        signal: AbortSignal,
        onEvent: NonNullable<typeof fixture.push>,
      ) => {
        fixture.push = onEvent;
        fixture.signal = signal;
        onEvent({ event: "snapshot", data: fixture.translations });
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
    ),
    translate: vi.fn(async () => ({ queued: true })),
  },
  blockImageURL: () => "",
}));
vi.mock("../chat/MessageMarkdown", () => ({
  MessageMarkdown: ({ content }: { content: string }) => <p>{content}</p>,
}));
const adapter = {
  open: vi.fn(async () => {}),
  getTOC: vi.fn(async () => []),
  getLocation: () => ({ type: "pdf", page: 1 }),
  goTo: vi.fn(async () => {}),
  next: vi.fn(async () => {}),
  previous: vi.fn(async () => {}),
  search: vi.fn(async () => []),
  getSelection: () => null,
  clearSelection: vi.fn(),
  highlight: vi.fn(async () => {}),
  setTheme: vi.fn(async () => {}),
  getContext: vi.fn(async () => ""),
  destroy: vi.fn(async () => {}),
  focusBlock: vi.fn(async () => {}),
  cancelBlockFocus: vi.fn(),
  followBlock: vi.fn(async () => {}),
  focusSentences: vi.fn(async () => {}),
  hoverBlock: vi.fn(),
} as unknown as ReaderAdapter;
vi.mock("../ReaderView", () => ({
  ReaderView: ({
    events,
    onReady,
  }: {
    events: ReaderEvents;
    onReady: (a: ReaderAdapter, t: []) => void;
  }) => {
    fixture.events = events;
    useEffect(() => onReady(adapter, []), []);
    return <div>PDF 原文</div>;
  },
}));
import { PDFReadingView } from "./PDFReadingView";
let root: Root, host: HTMLDivElement;
const events = { location: vi.fn(), selection: vi.fn() };
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  fixture.translations = [
    {
      blockId: "p1-b1",
      sourceHash: "hash",
      status: "complete",
      sentences: [
        { source: "First sentence.", target: "第一句。" },
        { source: "Second sentence.", target: "第二句。" },
      ],
    },
  ];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await renderView();
});
async function renderView(
  theme: ReaderTheme = defaultTheme,
  extraBlocks: PDFBlock[] = [],
) {
  await act(async () =>
    root.render(
      <PDFReadingView
        document={{ id: "doc", type: "pdf" } as Document}
        theme={theme}
        annotations={[]}
        blocks={[
          {
            id: "p1-b1",
            page: 1,
            label: "text",
            text: "First sentence. Second sentence.",
            bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.3 },
          },
          ...extraBlocks,
        ]}
        events={events}
        onReady={(a) => {
          fixture.ready = a;
        }}
      />,
    ),
  );
}

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.getSelection()?.removeAllRanges();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
async function click(label: string) {
  const button = Array.from(
    host.querySelectorAll<HTMLButtonElement>("button"),
  ).find(
    (b) => b.textContent === label || b.getAttribute("aria-label") === label,
  )!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
it("switches modes without recreating the PDF and links an original selection to its sentence", async () => {
  await click("原文译文");
  expect(adapter.focusBlock).not.toHaveBeenCalled();
  await act(async () =>
    fixture.events!.selection({
      text: "Second",
      location: {
        type: "pdf",
        page: 1,
        rects: [{ x: 0.1, y: 0.25, width: 0.2, height: 0.02 }],
      },
    }),
  );
  const marked = host.querySelector('[data-sentence="1"]');
  expect(marked?.hasAttribute("data-linked")).toBe(true);
  expect(
    host.querySelector('[data-sentence="0"]')?.hasAttribute("data-linked"),
  ).toBe(false);
  await click("仅译文");
  expect(host.querySelector(".translation-source")?.hasAttribute("inert")).toBe(
    true,
  );
  await click("仅原文");
  expect(host.querySelector(".translation-document")).toBeNull();
  expect(adapter.destroy).not.toHaveBeenCalled();
});
it("keeps the translated selection as the quote and anchors its counterpart to original text", async () => {
  const highlights = new Map<string, Set<Range>>();
  vi.stubGlobal("CSS", { highlights });
  vi.stubGlobal(
    "Highlight",
    class extends Set<Range> {
      constructor(...ranges: Range[]) {
        super(ranges);
      }
    },
  );
  await click("原文译文");
  const sentence = host.querySelector('[data-sentence="1"] p')!;
  await act(async () =>
    sentence.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })),
  );
  const range = document.createRange();
  range.selectNodeContents(sentence);
  Object.assign(range, {
    getBoundingClientRect: () => new DOMRect(200, 100, 80, 20),
  });
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
  expect(
    [...highlights.get("reader-translation-selection")!][0].toString(),
  ).toBe("第二句。");
  expect(
    host
      .querySelector(".translation-document")
      ?.hasAttribute("data-compact-selection"),
  ).toBe(true);
  await act(async () =>
    sentence.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })),
  );
  expect(events.selection).toHaveBeenLastCalledWith(
    expect.objectContaining({
      text: "第二句。",
      location: expect.objectContaining({
        quote: "Second sentence.",
        translation: expect.objectContaining({
          blockId: "p1-b1",
          sentenceIndexes: [1],
        }),
      }),
    }),
  );
  expect(adapter.focusSentences).toHaveBeenLastCalledWith(
    "p1-b1",
    ["Second sentence."],
    true,
  );
  await act(async () => fixture.ready!.clearSelection());
  expect(events.selection).toHaveBeenLastCalledWith(null);
  document.dispatchEvent(new Event("selectionchange"));
  expect(highlights.has("reader-translation-selection")).toBe(false);
});
it("restores the translated reading position without changing zoom on mode change", async () => {
  await click("仅译文");
  const pane = host.querySelector<HTMLElement>(".translation-document")!;
  const block = pane.querySelector<HTMLElement>("[data-translation-block]")!;
  pane.getBoundingClientRect = () => new DOMRect(0, 0, 600, 600);
  block.getBoundingClientRect = () => new DOMRect(0, 80, 600, 400);
  await act(async () => {
    pane.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 }));
    pane.dispatchEvent(new Event("scroll", { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  expect(adapter.followBlock).not.toHaveBeenCalled();
  await click("原文译文");
  expect(adapter.followBlock).toHaveBeenLastCalledWith({
    blockId: "p1-b1",
    fraction: 0.55,
  });
  expect(adapter.focusBlock).not.toHaveBeenCalled();
});

it("renders an incoming paragraph while the subscription remains open", async () => {
  await click("原文译文");
  const block = fixture.translations[0];
  await act(async () =>
    fixture.push!({
      event: "snapshot",
      data: [{ ...block, status: "pending", sentences: [] }],
    }),
  );
  expect(host.textContent).toContain("正在翻译中");
  expect(host.textContent).not.toContain("优先翻译");
  await act(async () => fixture.push!({ event: "translation", data: block }));
  expect(host.textContent).toContain("第一句。");
  expect(fixture.signal!.aborted).toBe(false);
});

it("links block hover in both directions and clears it without changing sentence selections", async () => {
  await click("原文译文");
  vi.mocked(adapter.focusSentences!).mockClear();
  await act(async () =>
    fixture.events!.blockHover?.({
      id: "p1-b1",
    } as import("@reader/core").PDFBlock),
  );
  const block = host.querySelector<HTMLElement>(
    '[data-translation-block="p1-b1"]',
  )!;
  expect(block.hasAttribute("data-hovered")).toBe(true);
  await act(async () => fixture.events!.blockHover?.(null));
  expect(block.hasAttribute("data-hovered")).toBe(false);
  await act(async () =>
    block.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })),
  );
  expect(adapter.hoverBlock).toHaveBeenLastCalledWith("p1-b1");
  expect(block.hasAttribute("data-hovered")).toBe(true);
  await act(async () =>
    block.dispatchEvent(
      new MouseEvent("pointerout", { bubbles: true, relatedTarget: host }),
    ),
  );
  expect(adapter.hoverBlock).toHaveBeenLastCalledWith(null);
  expect(block.hasAttribute("data-hovered")).toBe(false);
  expect(adapter.focusSentences).not.toHaveBeenCalled();
  expect(adapter.clearSelection).not.toHaveBeenCalled();
  await act(async () =>
    block.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })),
  );
  await click("仅原文");
  expect(adapter.hoverBlock).toHaveBeenLastCalledWith(null);
});

it("provides a resizable divider with the swap action outside the toolbar", async () => {
  await click("原文译文");
  const divider = host.querySelector<HTMLElement>('[role="separator"]');
  expect(divider).not.toBeNull();
  expect(divider!.getAttribute("aria-orientation")).toBe("vertical");
  const swap = host.querySelector('[aria-label="交换原文和译文"]')!;
  expect(swap.closest(".translation-panes")).not.toBeNull();
  expect(
    host.querySelector('.translation-toolbar [aria-label="交换原文和译文"]'),
  ).toBeNull();
  await click("交换原文和译文");
  expect(adapter.destroy).not.toHaveBeenCalled();
});

it("has no single-column mode and only zooms on an explicit block focus", async () => {
  expect(host.textContent).not.toContain("单栏模式");
  expect(host.textContent).not.toContain("普通模式");
  expect(host.querySelector('[aria-label="下一段"]')).toBeNull();
  expect(adapter.focusBlock).not.toHaveBeenCalled();
  await act(async () =>
    fixture.events!.blockFocus?.({
      id: "p1-b1",
      page: 1,
      bounds: { x: 0, y: 0 },
    } as PDFBlock),
  );
  expect(adapter.focusBlock).toHaveBeenLastCalledWith("p1-b1", "source");
  await click("原文译文");
  await act(async () =>
    fixture.events!.blockFocus?.({
      id: "p1-b1",
      page: 1,
      bounds: { x: 0, y: 0 },
    } as PDFBlock),
  );
  expect(adapter.focusBlock).toHaveBeenLastCalledWith("p1-b1", "parallel");
});

it("always follows scrolling in either pane without an unlink control", async () => {
  await click("原文译文");
  expect(host.querySelector('[aria-label="同步滚动"]')).toBeNull();
  const pane = host.querySelector<HTMLElement>(".translation-document")!;
  const block = pane.querySelector<HTMLElement>("[data-translation-block]")!;
  pane.getBoundingClientRect = () => new DOMRect(0, 0, 600, 600);
  block.getBoundingClientRect = () => new DOMRect(0, 80, 600, 400);
  await act(async () =>
    fixture.events!.readingAnchor?.({ blockId: "p1-b1", fraction: 0.5 }),
  );
  expect(pane.scrollTop).toBe(-20);
  expect(host.querySelector("[data-focused]")).toBeNull();
  await act(async () => {
    pane.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 }));
    pane.dispatchEvent(new Event("scroll", { bubbles: true }));
    await new Promise(requestAnimationFrame);
  });
  expect(adapter.followBlock).toHaveBeenLastCalledWith({
    blockId: "p1-b1",
    fraction: 0.55,
  });
});

function translationGeometry(height = 200) {
  const pane = host.querySelector<HTMLElement>(".translation-document")!;
  const block = pane.querySelector<HTMLElement>("[data-translation-block]")!;
  Object.defineProperties(pane, {
    clientWidth: { value: 600, configurable: true },
    clientHeight: { value: 600, configurable: true },
    scrollHeight: { value: 2400, configurable: true },
  });
  pane.getBoundingClientRect = () => new DOMRect(0, 0, 600, 600);
  block.getBoundingClientRect = () =>
    new DOMRect(40, 600 - pane.scrollTop, 520, height);
  return { pane, block };
}
it("smoothly centers clicked translation blocks and follows their original without scroll feedback", async () => {
  await click("原文译文");
  const { pane, block } = translationGeometry();
  vi.useFakeTimers();
  try {
    await act(async () => block.click());
    expect(pane.scrollTop).toBe(0);
    expect(block.hasAttribute("data-focused")).toBe(true);
    expect(adapter.focusBlock).toHaveBeenLastCalledWith("p1-b1", "parallel");
    const calls = vi.mocked(adapter.focusBlock!).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    expect(pane.scrollTop).toBeGreaterThan(0);
    expect(pane.scrollTop).toBeLessThan(400);
    await act(async () => {
      pane.dispatchEvent(new Event("scroll", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(pane.scrollTop).toBe(400);
    expect(block.hasAttribute("data-focused")).toBe(false);
    expect(adapter.focusBlock).toHaveBeenCalledTimes(calls);
    expect(adapter.followBlock).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
it("top-aligns tall translation blocks and cancels their motion when the user scrolls", async () => {
  await click("仅译文");
  const { pane, block } = translationGeometry(800);
  vi.useFakeTimers();
  try {
    await act(async () => block.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(pane.scrollTop).toBe(600);
    expect(adapter.followBlock).not.toHaveBeenCalled();
    pane.scrollTop = 0;
    await act(async () => block.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(96);
    });
    await act(async () =>
      pane.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: 30 }),
      ),
    );
    pane.scrollTop = 75;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(pane.scrollTop).toBe(75);
  } finally {
    vi.useRealTimers();
  }
});
it("does not treat drags, native selections or interactive controls as block navigation", async () => {
  await click("原文译文");
  const { pane, block } = translationGeometry();
  await act(async () => {
    block.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    block.dispatchEvent(
      new MouseEvent("pointerup", { bubbles: true, clientX: 40, clientY: 40 }),
    );
    block.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        clientX: 40,
        clientY: 40,
        detail: 1,
      }),
    );
  });
  const button = document.createElement("button");
  block.append(button);
  await act(async () => button.click());
  const range = document.createRange();
  range.selectNodeContents(block.querySelector("p")!);
  window.getSelection()!.addRange(range);
  await act(async () => block.click());
  expect(adapter.followBlock).not.toHaveBeenCalled();
  expect(pane.scrollTop).toBe(0);
});

it("replaces an unfinished click with an image focus and does not re-highlight on scroll", async () => {
  await renderView(defaultTheme, [
    {
      id: "p1-image",
      page: 1,
      label: "chart",
      text: "",
      image: "figure.png",
      bounds: { x: 0.55, y: 0.4, width: 0.3, height: 0.2 },
    },
  ]);
  await click("原文译文");
  const { pane, block } = translationGeometry();
  const image = pane.querySelector<HTMLElement>(
    '[data-translation-block="p1-image"]',
  )!;
  image.getBoundingClientRect = () =>
    new DOMRect(40, 1000 - pane.scrollTop, 520, 200);
  vi.useFakeTimers();
  try {
    await act(async () => block.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(96);
    });
    const before = pane.scrollTop;
    await act(async () => image.querySelector("img")!.click());
    expect(pane.scrollTop).toBe(before);
    expect(block.hasAttribute("data-focused")).toBe(false);
    expect(image.hasAttribute("data-focused")).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(pane.scrollTop).toBe(800);
    expect(adapter.focusBlock).toHaveBeenLastCalledWith("p1-image", "parallel");
    await act(async () => {
      host
        .querySelector(".translation-source")!
        .dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 1 }));
      fixture.events!.readingAnchor?.({ blockId: "p1-b1", fraction: 0.5 });
    });
    expect(block.hasAttribute("data-focused")).toBe(false);
    expect(image.hasAttribute("data-focused")).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
it("does not focus during manual scrolling and cancels keyboard focus when the pane closes", async () => {
  await click("仅译文");
  const { pane, block } = translationGeometry();
  vi.useFakeTimers();
  try {
    await act(async () => {
      pane.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: 30 }),
      );
      pane.dispatchEvent(new Event("scroll", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(32);
    });
    expect(block.hasAttribute("data-focused")).toBe(false);
    await act(async () =>
      block.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(96);
    });
    expect(pane.scrollTop).toBeGreaterThan(0);
    const top = pane.scrollTop;
    await click("仅原文");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(pane.scrollTop).toBe(top);
    expect(host.querySelector(".translation-document")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("centers both panels from a source click and recalculates a focused translation after resizing", async () => {
  await click("原文译文");
  const { pane, block } = translationGeometry(800);
  let width = 600,
    height = 600,
    blockHeight = 800;
  Object.defineProperties(pane, {
    clientWidth: { get: () => width, configurable: true },
    clientHeight: { get: () => height, configurable: true },
    scrollWidth: { value: 1600, configurable: true },
  });
  pane.getBoundingClientRect = () => new DOMRect(50, 20, width, height);
  block.getBoundingClientRect = () =>
    new DOMRect(150 - pane.scrollLeft, 620 - pane.scrollTop, 400, blockHeight);
  const sourceBlock = {
    id: "p1-b1",
    page: 1,
    bounds: { x: 0.1, y: 0.2, width: 0.4, height: 0.1 },
  } as PDFBlock;
  vi.useFakeTimers();
  try {
    await act(async () => fixture.events!.blockFocus?.(sourceBlock));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(pane.scrollTop).toBe(600); // tall translation top, independent of short original
    expect(adapter.focusBlock).toHaveBeenLastCalledWith("p1-b1", "parallel");
    await act(async () => {
      fixture.events!.readingAnchor?.({ blockId: "p1-b1", fraction: 0.5 });
      pane.dispatchEvent(new Event("scroll"));
      await vi.advanceTimersByTimeAsync(32);
    });
    expect(pane.scrollTop).toBe(600); // late programmatic events cannot recenter it
    width = 400;
    height = 500;
    blockHeight = 200;
    await act(async () => block.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(pane.scrollTop).toBe(450);
    expect(pane.scrollLeft).toBe(100);
    expect(adapter.focusBlock).toHaveBeenCalledTimes(2);
    expect(adapter.followBlock).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

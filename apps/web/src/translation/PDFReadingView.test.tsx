// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  defaultTheme,
  type Document,
  type ReaderAdapter,
  type ReaderEvents,
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
  fitColumn: vi.fn(async () => {}),
  stopColumnFit: vi.fn(),
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
  await act(async () =>
    root.render(
      <PDFReadingView
        document={{ id: "doc", type: "pdf" } as Document}
        theme={defaultTheme}
        annotations={[]}
        blocks={[
          {
            id: "p1-b1",
            page: 1,
            label: "text",
            text: "First sentence. Second sentence.",
            bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.3 },
          },
        ]}
        events={events}
        onReady={(a) => {
          fixture.ready = a;
        }}
      />,
    ),
  );
});
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
  expect(adapter.fitColumn).toHaveBeenCalledTimes(1);
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
});
it("restores the translated reading position before fitting the original on mode change", async () => {
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
    fraction: 0.25,
  });
  expect(
    vi.mocked(adapter.followBlock!).mock.invocationCallOrder[0],
  ).toBeLessThan(vi.mocked(adapter.fitColumn!).mock.invocationCallOrder[0]);
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

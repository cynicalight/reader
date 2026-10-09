// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  defaultTheme,
  type Document,
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
    epubBlocks: vi.fn(async () => blocks),
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
  publicationURL: (_id: string, path: string) => `/publication/${path}`,
}));
vi.mock("../chat/MessageMarkdown", () => ({
  MessageMarkdown: ({ content }: { content: string }) => <p>{content}</p>,
}));
const adapter = {
  open: vi.fn(async () => {}),
  getTOC: vi.fn(async () => []),
  getLocation: () => ({ type: "epub", href: "a.xhtml" }),
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
  setEPUBBlocks: vi.fn(),
  fitColumn: vi.fn(async () => {}),
  stopColumnFit: vi.fn(),
  followBlock: vi.fn(async () => {}),
  focusSentences: vi.fn(async () => {}),
  focusEPUBLocations: vi.fn(async () => {}),
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
    return <div>EPUB 原文</div>;
  },
}));
import { EPUBReadingView } from "./EPUBReadingView";
const blocks: import("@reader/core").EPUBReadingBlock[] = [
  "a.xhtml",
  "b.xhtml",
].map((href, i) => ({
  id: i ? "e-b" : "p1-b1",
  label: "text",
  text: "First sentence. Second sentence.",
  location: {
    type: "epub",
    href,
    quote: "First sentence. Second sentence.",
    locator: JSON.stringify({
      href,
      type: "application/xhtml+xml",
      locations: {
        textRange: { start: 0, end: 32 },
        domRange: {
          start: { cssSelector: "p", textNodeIndex: 0, charOffset: 0 },
          end: { cssSelector: "p", textNodeIndex: 0, charOffset: 32 },
        },
      },
      text: { highlight: "First sentence. Second sentence." },
    }),
  },
}));
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
  vi.clearAllMocks();
  await renderView();
});
async function renderView(theme: ReaderTheme = defaultTheme) {
  await act(async () =>
    root.render(
      <EPUBReadingView
        document={{ id: "doc", type: "epub" } as Document}
        theme={theme}
        annotations={[]}
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

it("supports all modes and chapter navigation without PDF page locations", async () => {
  await click("仅译文");
  expect(host.querySelector('[data-mode="translation"]')).toBeTruthy();
  vi.mocked(adapter.goTo).mockClear();
  await act(async () => fixture.ready!.next());
  expect(events.location).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: "epub", href: "b.xhtml" }),
    expect.any(Number),
  );
  expect(adapter.goTo).not.toHaveBeenCalled();
  expect(await fixture.ready!.getContext()).toBe(blocks[1].text);
  expect(adapter.getContext).not.toHaveBeenCalled();
  await click("原文译文");
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
  expect(adapter.goTo).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: "epub", href: "b.xhtml" }),
  );
});
it("keeps translated selection while source navigation emits selection resets", async () => {
  await click("原文译文");
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
  const sentence = host.querySelector('[data-sentence="1"]')!;
  const range = document.createRange();
  range.selectNodeContents(sentence);
  Object.assign(range, {
    getBoundingClientRect: () => new DOMRect(0, 0, 100, 20),
  });
  window.getSelection()!.addRange(range);
  await act(async () =>
    sentence.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })),
  );
  const selected = fixture.ready!.getSelection()!;
  expect(selected.location.type).toBe("epub");
  expect(selected.location.translation?.sentenceIndexes).toEqual([1]);
  await act(async () => fixture.events!.selection(null));
  expect(fixture.ready!.getSelection()).toBe(selected);
  await act(async () => fixture.ready!.clearSelection());
  expect(window.getSelection()!.rangeCount).toBe(0);
  expect(events.selection).toHaveBeenLastCalledWith(null);
});
it("restores an original interaction after following the translated pane", async () => {
  await click("仅译文");
  await click("原文译文");
  await act(async () => fixture.events!.epubInteraction?.());
  await act(async () =>
    fixture.events!.selection({
      text: "Second",
      location: {
        ...blocks[0].location,
        locator: JSON.stringify({
          locations: { textRange: { start: 16, end: 22 } },
        }),
      },
    }),
  );
  expect(
    host.querySelector('[data-sentence="0"]')?.hasAttribute("data-linked"),
  ).toBe(false);
  expect(
    host.querySelector('[data-sentence="1"]')?.hasAttribute("data-linked"),
  ).toBe(true);
});
it("keeps the translation subscription alive across modes and aborts on close", async () => {
  await click("原文译文");
  await click("仅译文");
  expect(fixture.signal?.aborted).toBe(false);
  await act(async () => root.unmount());
  expect(fixture.signal?.aborted).toBe(true);
});

it("renders successive chapters together without chapter-turn buttons", async () => {
  await click("仅译文");
  expect(
    Array.from(host.querySelectorAll("[data-chapter]")).map((n) =>
      n.getAttribute("data-chapter"),
    ),
  ).toEqual(["a.xhtml", "b.xhtml"]);
  expect(host.textContent).not.toContain("下一章");
  expect(host.textContent).not.toContain("上一章");
});

it("retains both original chapter locations when selecting across a chapter boundary", async () => {
  await act(async () =>
    fixture.push!({
      event: "snapshot",
      data: [
        ...fixture.translations,
        { ...fixture.translations[0], blockId: "e-b" },
      ],
    }),
  );
  await click("仅译文");
  const start = host.querySelector(
    '[data-chapter="a.xhtml"] [data-sentence="1"]',
  )!;
  const end = host.querySelector(
    '[data-chapter="b.xhtml"] [data-sentence="0"]',
  )!;
  const range = document.createRange();
  range.setStart(start, 0);
  range.setEnd(end, end.childNodes.length);
  Object.assign(range, {
    getBoundingClientRect: () => new DOMRect(0, 0, 100, 60),
  });
  window.getSelection()!.addRange(range);
  await act(async () =>
    end.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })),
  );
  expect(
    fixture
      .ready!.getSelection()
      ?.location.translation?.ranges?.map((r) => r.location?.href),
  ).toEqual(["a.xhtml", "b.xhtml"]);
});

it("follows the latest translated position after an earlier chapter navigation finishes", async () => {
  await act(async () =>
    fixture.push!({
      event: "snapshot",
      data: [
        ...fixture.translations,
        { ...fixture.translations[0], blockId: "e-b" },
      ],
    }),
  );
  await click("原文译文");
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
  vi.mocked(adapter.goTo).mockClear();
  let release!: () => void;
  vi.mocked(adapter.goTo).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const select = async (href: string) => {
    const node = host.querySelector(
      `[data-chapter="${href}"] [data-sentence="0"]`,
    )!;
    const range = document.createRange();
    range.selectNodeContents(node);
    Object.assign(range, {
      getBoundingClientRect: () => new DOMRect(0, 0, 100, 20),
    });
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    await act(async () =>
      node.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })),
    );
  };
  await select("a.xhtml");
  await select("b.xhtml");
  expect(adapter.goTo).toHaveBeenCalledTimes(1);
  await act(async () => release());
  expect(adapter.goTo).toHaveBeenCalledTimes(2);
  expect(adapter.goTo).toHaveBeenLastCalledWith(
    expect.objectContaining({ href: "b.xhtml" }),
  );
});

it("uses independent translation typography even when old preferences request pagination", async () => {
  await renderView({
    ...defaultTheme,
    epubFlow: "paginated",
    fontSize: 1.5,
    translationFontSize: 1.1,
    translationFontFamily: "sans-serif",
    translationFontWeight: "bold",
  });
  const pane = host.querySelector<HTMLElement>(".translation-document")!;
  expect(pane.style.fontSize).toBe("1.1rem");
  expect(pane.style.fontFamily).toBe("inherit");
  expect(pane.style.fontWeight).toBe("600");
  expect(host.querySelector(".pdf-page-navigation")).toBeNull();
});
it("focuses the matching block slice when a translated sentence is selected", async () => {
  await click("原文译文");
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
  const sentence = host.querySelector('[data-sentence="1"]')!;
  const range = document.createRange();
  range.selectNodeContents(sentence);
  Object.assign(range, {
    getBoundingClientRect: () => new DOMRect(0, 0, 100, 20),
  });
  window.getSelection()!.addRange(range);
  await act(async () =>
    sentence.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })),
  );
  expect(adapter.focusEPUBLocations).toHaveBeenLastCalledWith([
    expect.objectContaining({ blockId: "p1-b1", start: 16, end: 32 }),
  ]);
  expect(adapter.goTo).toHaveBeenLastCalledWith(
    expect.objectContaining({
      blockId: "p1-b1",
      start: 16,
      end: 32,
      quote: undefined,
    }),
  );
});
it("follows source block anchors and scrolls the source to the translated block in both directions", async () => {
  await click("原文译文");
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
  const pane = host.querySelector<HTMLElement>(".translation-document")!;
  Object.defineProperty(pane, "clientHeight", { value: 400 });
  pane.getBoundingClientRect = () => new DOMRect(0, 0, 400, 400);
  const nodes = Array.from(
    pane.querySelectorAll<HTMLElement>("[data-translation-block]"),
  );
  nodes[0].getBoundingClientRect = () => new DOMRect(0, -200, 400, 100);
  nodes[1].getBoundingClientRect = () => new DOMRect(0, 300, 400, 100);
  await act(async () => fixture.events!.epubReadingAnchor?.("e-b"));
  expect(pane.scrollTop).toBe(200);
  vi.mocked(adapter.goTo).mockClear();
  await act(async () => {
    pane.dispatchEvent(new Event("wheel", { bubbles: true }));
    pane.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(adapter.goTo).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: "epub",
      href: "b.xhtml",
      quote: undefined,
    }),
  );
});

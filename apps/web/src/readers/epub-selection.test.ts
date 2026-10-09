// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  Decoration,
  DecorationObserver,
  EpubNavigatorListeners,
} from "@readium/navigator";
import {
  defaultTheme,
  type Annotation,
  type Document as ReaderDocument,
} from "@reader/core";
import { Locator, Publication } from "@readium/shared";

const bridge = vi.hoisted(() => ({
  listeners: undefined as EpubNavigatorListeners | undefined,
  observer: undefined as DecorationObserver | undefined,
  apply: vi.fn(),
  go: vi.fn(),
  load: vi.fn(),
  preferences: vi.fn(),
  forward: vi.fn(),
  update: vi.fn(async (..._args: unknown[]) => {}),
}));
vi.mock("@readium/navigator", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@readium/navigator")>()),
  DecorationLayout: { Boxes: "boxes" },
  DecorationWidth: { Wrap: "wrap" },
  EpubNavigator: class {
    constructor(
      _container: HTMLElement,
      _publication: unknown,
      listeners: EpubNavigatorListeners,
      _positions: unknown,
      _initial: unknown,
      options: { preferences: unknown },
    ) {
      bridge.preferences(options.preferences);
      bridge.listeners = listeners;
    }
    framePool = { update: bridge.update };
    goForward(_animated: boolean, callback: (ok: boolean) => void) {
      bridge.forward();
      callback(true);
    }
    go(locator: Locator, _animated: boolean, callback: (ok: boolean) => void) {
      bridge.go(locator);
      callback(true);
    }
    get _cframes() {
      return [
        { iframe: frame, source: "blob:http://localhost/active-chapter" },
      ];
    }
    eventListener(_key: string, selection: Record<string, unknown>) {
      bridge.listeners!.textSelected({
        ...selection,
        locator: payload().locator,
      } as ReturnType<typeof payload>);
    }
    async load() {
      return bridge.load();
    }
    async destroy() {}
    async submitPreferences(preferences: unknown) {
      bridge.preferences(preferences);
    }
    registerDecorationObserver(_group: string, observer: DecorationObserver) {
      bridge.observer = observer;
    }
    unregisterDecorationObserver(observer: DecorationObserver) {
      if (bridge.observer === observer) bridge.observer = undefined;
    }
    applyDecorations(decorations: Decoration[], group: string) {
      bridge.apply(decorations, group);
    }
  },
}));
import { EPUBReaderAdapter } from "./epub";

let adapter: EPUBReaderAdapter;
let host: HTMLDivElement;
let frame: HTMLIFrameElement;
const changed = vi.fn();
const activated = vi.fn();
const payload = () => ({
  text: "Selected passage",
  x: 40,
  y: 100,
  width: 180,
  height: 20,
  locator: Locator.deserialize({
    href: "chapter.xhtml",
    type: "application/xhtml+xml",
  })!,
  // Readium navigates contentWindow.location, leaving iframe.src empty.
  targetFrameSrc: "blob:http://localhost/active-chapter",
});
beforeEach(async () => {
  changed.mockClear();
  activated.mockClear();
  bridge.apply.mockClear();
  bridge.go.mockClear();
  bridge.load.mockReturnValue(true);
  bridge.preferences.mockClear();
  bridge.forward.mockClear();
  bridge.update.mockClear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<html><body><p>Selected passage</p></body></html>",
      json: async () => ({
        metadata: { title: "Test book" },
        readingOrder: [
          { href: "chapter.xhtml", type: "application/xhtml+xml" },
          { href: "next.xhtml", type: "application/xhtml+xml" },
        ],
      }),
    }),
  );
  vi.spyOn(Publication.prototype, "positionsFromManifest").mockResolvedValue([
    Locator.deserialize({
      href: "chapter.xhtml",
      type: "application/xhtml+xml",
      locations: { position: 1 },
    })!,
  ]);
  host = document.createElement("div");
  document.body.append(host);
  adapter = new EPUBReaderAdapter(host, {
    location: vi.fn(),
    selection: changed,
    annotation: activated,
  });
  await adapter.open({ id: "test", type: "epub" } as ReaderDocument);
  frame = document.createElement("iframe");
  host.append(frame);
  const wnd = frame.contentWindow!;
  wnd.document.body.innerHTML = "<p>Selected passage</p>";
  bridge.listeners!.frameLoaded!(wnd);
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(
    new DOMRect(300, 60, 600, 800),
  );
  const range = wnd.document.createRange();
  const text = wnd.document.querySelector("p")!.firstChild!;
  range.setStart(text, 0);
  range.setEnd(text, text.textContent!.length);
  Object.assign(range, {
    getClientRects: () => [new DOMRect(40, 100, 180, 20)],
  });
  wnd.getSelection()!.addRange(range);
  wnd.document.dispatchEvent(
    new MouseEvent("mouseup", { clientX: 210, clientY: 110 }),
  );
  bridge.listeners!.textSelected(payload());
  expect(adapter.getSelection()?.text).toBe("Selected passage");
});
afterEach(async () => {
  await adapter.destroy();
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("clears the toolbar when an EPUB iframe selection collapses", () => {
  frame.contentWindow!.getSelection()!.removeAllRanges();
  frame.contentDocument!.dispatchEvent(new Event("selectionchange"));
  expect(adapter.getSelection()).toBeNull();
  expect(changed).toHaveBeenLastCalledWith(null);
});
it("does not resurrect a dismissed selection from a delayed Readium callback", () => {
  adapter.clearSelection();
  expect(frame.contentWindow!.getSelection()!.rangeCount).toBe(0);
  bridge.listeners!.textSelected(payload());
  expect(adapter.getSelection()).toBeNull();
});
it("converts the EPUB mouse release point into renderer coordinates", () => {
  expect(adapter.getSelection()?.anchor).toEqual({
    x: 510,
    top: 160,
    bottom: 180,
  });
});

async function savedAnnotation() {
  const selection = adapter.getSelection()!;
  const annotation: Annotation = {
    id: "note",
    documentId: "test",
    kind: "note",
    location: selection.location,
    quote: selection.text,
    note: "Saved note",
    color: "#e6b94c",
    createdAt: "",
  };
  await adapter.highlight([annotation]);
  const decoration = (bridge.apply.mock.calls.at(-1)![0] as Decoration[])[0]!;
  adapter.clearSelection();
  activated.mockClear();
  return {
    decoration,
    group: "annotations",
    rect: { top: 100, left: 40, width: 180, height: 20 },
    point: { x: 210, y: 110 },
  };
}
function pointer(type: string, extra: MouseEventInit = {}) {
  frame.contentDocument!.querySelector("p")!.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      clientX: 210,
      clientY: 110,
      ...extra,
    }),
  );
}
it("uses Readium hover decorations and converts annotation clicks out of the iframe", async () => {
  const event = await savedAnnotation();
  pointer("pointermove");
  bridge.observer!.onDecorationPointerEnter!(event);
  expect(bridge.apply).toHaveBeenLastCalledWith(
    [
      expect.objectContaining({
        id: "note",
        style: expect.objectContaining({ type: "template" }),
      }),
    ],
    "annotation-hover",
  );
  pointer("pointerdown");
  pointer("pointerup");
  expect(bridge.observer!.onDecorationActivated!(event)).toBe(true);
  expect(activated).toHaveBeenLastCalledWith({
    ids: ["note"],
    anchor: { x: 510, top: 162, bottom: 178 },
  });
  frame.contentDocument!.dispatchEvent(new Event("scroll"));
  expect(activated).toHaveBeenLastCalledWith(null);
  expect(bridge.observer!.onDecorationActivated!(event)).toBe(false);
});
it("does not activate annotations on drags or stale callbacks after deletion", async () => {
  const event = await savedAnnotation();
  pointer("pointerdown");
  pointer("pointerup", { clientX: 240 });
  expect(bridge.observer!.onDecorationActivated!(event)).toBe(false);
  pointer("pointerdown");
  pointer("pointerup");
  await adapter.highlight([]);
  expect(bridge.observer!.onDecorationActivated!(event)).toBe(false);
  pointer("pointermove");
  bridge.observer!.onDecorationPointerEnter!(event);
  expect(bridge.apply).toHaveBeenLastCalledWith([], "annotations");
});
it("preserves native selection and removes the decoration observer on disposal", async () => {
  const event = await savedAnnotation();
  pointer("pointerdown");
  const range = frame.contentDocument!.createRange();
  range.selectNodeContents(frame.contentDocument!.querySelector("p")!);
  frame.contentWindow!.getSelection()!.addRange(range);
  pointer("pointerup");
  expect(bridge.observer!.onDecorationActivated!(event)).toBe(false);
  const observer = bridge.observer!;
  await adapter.destroy();
  expect(bridge.observer).toBeUndefined();
  expect(observer.onDecorationActivated!(event)).toBe(false);
});

it("preserves the exact saved selection when navigating and rejects ambiguous legacy quotes", async () => {
  const location = adapter.getSelection()!.location;
  await adapter.goTo(location);
  expect(
    bridge.go.mock.calls[0]![0].serialize().locations.domRange,
  ).toBeDefined();
  const ambiguous = {
    type: "epub" as const,
    href: "chapter.xhtml",
    quote: "missing",
  };
  await expect(adapter.goTo(ambiguous)).rejects.toThrow("未能唯一定位");
  expect(bridge.go).toHaveBeenCalledTimes(1);
});
it("keeps unresolved notes in storage while removing their obsolete decorations", async () => {
  const event = await savedAnnotation();
  const location = {
    type: "epub" as const,
    href: "chapter.xhtml",
    quote: "missing",
  };
  await expect(
    adapter.highlight([
      {
        id: "note",
        documentId: "test",
        kind: "note",
        location,
        quote: "missing",
        note: "Preserve me",
        color: "",
        createdAt: "",
      },
    ]),
  ).rejects.toThrow("已保留在笔记中");
  expect(bridge.apply).toHaveBeenLastCalledWith([], "annotations");
  expect(event.decoration.id).toBe("note");
});
it("rejects an inner locator targeting a different chapter", async () => {
  await expect(
    adapter.goTo({
      type: "epub",
      href: "chapter.xhtml",
      locator: JSON.stringify({
        href: "other.xhtml",
        type: "application/xhtml+xml",
        text: { highlight: "Selected passage" },
      }),
    }),
  ).rejects.toThrow("不一致");
  expect(bridge.go).not.toHaveBeenCalled();
});
it("does not replay a deleted annotation when its chapter fetch finishes late", async () => {
  const selected = adapter.getSelection()!;
  let release!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const pending = adapter.highlight([
    {
      id: "note",
      documentId: "test",
      kind: "note",
      location: selected.location,
      quote: selected.text,
      note: "",
      color: "",
      createdAt: "",
    },
  ]);
  await adapter.highlight([]);
  release({
    ok: true,
    text: async () => "<html><body><p>Selected passage</p></body></html>",
  } as Response);
  await pending;
  expect(bridge.apply).toHaveBeenLastCalledWith([], "annotations");
});

it("captures keyboard selections through the Readium frame event path", () => {
  changed.mockClear();
  frame.contentDocument!.dispatchEvent(
    new KeyboardEvent("keyup", { key: "Shift" }),
  );
  expect(changed).toHaveBeenLastCalledWith(
    expect.objectContaining({ text: "Selected passage" }),
  );
  expect(adapter.getSelection()?.location.type).toBe("epub");
});

it("rejects an empty Readium position list before creating a navigator", async () => {
  vi.mocked(Publication.prototype.positionsFromManifest).mockResolvedValueOnce(
    [],
  );
  bridge.load.mockClear();
  await expect(
    adapter.open({ id: "test", type: "epub" } as ReaderDocument),
  ).rejects.toThrow("EPUB 阅读位置为空");
  expect(bridge.load).not.toHaveBeenCalled();
});
it("reports a failed navigator load instead of displaying an empty reader", async () => {
  bridge.load.mockReturnValueOnce(false);
  await expect(
    adapter.open({ id: "test", type: "epub" } as ReaderDocument),
  ).rejects.toThrow("EPUB 正文加载失败");
});

it("publishes a selected passage and toolbar anchor when iframe.src is empty", () => {
  expect(frame.getAttribute("src")).toBeNull();
  expect(changed).toHaveBeenLastCalledWith(
    expect.objectContaining({
      text: "Selected passage",
      anchor: { x: 510, top: 160, bottom: 180 },
    }),
  );
  const location = adapter.getSelection()!.location;
  expect(location.type).toBe("epub");
  if (location.type === "epub") {
    expect(JSON.parse(location.locator!).locations.domRange).toBeDefined();
  }
});
it("ignores a delayed selection from an inactive chapter", () => {
  changed.mockClear();
  const current = adapter.getSelection();
  bridge.listeners!.textSelected({
    ...payload(),
    targetFrameSrc: "blob:http://localhost/previous-chapter",
  });
  expect(changed).not.toHaveBeenCalled();
  expect(adapter.getSelection()).toBe(current);
});
it.each(["highlight", "underline", "note"] as const)(
  "restores %s decorations from the same exact selected passage",
  async (kind) => {
    const selection = adapter.getSelection()!;
    await adapter.highlight([
      {
        id: kind,
        documentId: "test",
        kind,
        location: selection.location,
        quote: selection.text,
        note: kind === "note" ? "Saved note" : "",
        color: "#e6b94c",
        createdAt: "",
      },
    ]);
    const [decoration] = bridge.apply.mock.calls.at(-1)![0] as Decoration[];
    expect(decoration!.style).toEqual({
      type: kind === "underline" ? "underline" : "highlight",
      tint: "#e6b94c",
    });
    expect(decoration!.locator.serialize().locations.domRange).toBeDefined();
    await adapter.highlight([]);
    expect(bridge.apply).toHaveBeenLastCalledWith([], "annotations");
  },
);

it("restores each translated source slice and maps decoration clicks to the saved annotation", async () => {
  const source = adapter.getSelection()!.location;
  if (source.type !== "epub") throw Error("expected EPUB");
  const loc = JSON.parse(source.locator!);
  const slices = [
    { start: 0, end: 8 },
    { start: 9, end: 16 },
  ];
  const ranges = slices.map((slice, index) => ({
    blockId: `e-${index}`,
    sourceHash: "hash",
    sentenceIndexes: [0],
    start: 0,
    end: 2,
    quote: "译文",
    location: {
      ...source,
      locator: JSON.stringify({
        ...loc,
        locations: { ...loc.locations, sourceSlice: slice },
      }),
    },
  }));
  await adapter.focusEPUBLocations(ranges.map((r) => r.location));
  expect(bridge.apply.mock.calls.at(-1)![1]).toBe("translation-focus");
  expect(
    (bridge.apply.mock.calls.at(-1)![0] as Decoration[]).map(
      (d) => d.locator.text?.highlight,
    ),
  ).toEqual(["Selected", "passage"]);
  await adapter.focusEPUBLocations([]);
  expect(bridge.apply).toHaveBeenLastCalledWith([], "translation-focus");
  await adapter.highlight([
    {
      id: "translated-note",
      documentId: "test",
      kind: "underline",
      quote: "译文",
      note: "Keep",
      color: "#e6b94c",
      createdAt: "",
      location: { ...source, translation: { ...ranges[0], ranges } },
    },
  ]);
  const decorations = bridge.apply.mock.calls.at(-1)![0] as Decoration[];
  expect(decorations.map((d) => d.locator.text?.highlight)).toEqual([
    "Selected",
    "passage",
  ]);
  expect(decorations.map((d) => d.id)).toEqual([
    "translated-note:0",
    "translated-note:1",
  ]);
  expect(decorations[1].locator.serialize().locations).not.toHaveProperty(
    "sourceSlice",
  );
  adapter.clearSelection();
  pointer("pointerdown");
  pointer("pointerup");
  bridge.observer!.onDecorationActivated!({
    decoration: decorations[1],
    group: "annotations",
    rect: { top: 100, left: 40, width: 180, height: 20 },
    point: { x: 210, y: 110 },
  });
  expect(activated).toHaveBeenLastCalledWith(
    expect.objectContaining({ ids: ["translated-note"] }),
  );
  await adapter.highlight([]);
  expect(bridge.apply).toHaveBeenLastCalledWith([], "annotations");
});

const fade = () => {
  const animate = vi.fn((_frames: Keyframe[], _options?: unknown) => ({
    finished: Promise.resolve(),
    cancel: vi.fn(),
  }));
  host.animate = animate as unknown as typeof host.animate;
  return animate;
};
it("scrolls by default even when an old saved theme requested pagination", async () => {
  expect(bridge.preferences).toHaveBeenCalledWith(
    expect.objectContaining({ scroll: true }),
  );
  await adapter.setTheme({ ...defaultTheme, scroll: false });
  expect(bridge.preferences).toHaveBeenLastCalledWith(
    expect.objectContaining({ scroll: true }),
  );
  expect(bridge.listeners!.click({} as never)).toBe(true);
  expect(bridge.listeners!.tap({} as never)).toBe(true);
});

it("turns chosen pages behind a horizontal fade instead of a bare jump", async () => {
  const animate = fade();
  await adapter.setTheme({ ...defaultTheme, epubFlow: "paginated" });
  expect(bridge.preferences).toHaveBeenLastCalledWith(
    expect.objectContaining({ scroll: false }),
  );
  // The relayout between scrolling and pages is hidden too.
  expect(animate).toHaveBeenCalledTimes(2);
  animate.mockClear();
  await adapter.next();
  expect(bridge.forward).toHaveBeenCalledOnce();
  expect(animate).toHaveBeenCalledTimes(2);
  const [exit, enter] = animate.mock.calls.map((call) => call[0]);
  expect(exit.at(-1)).toMatchObject({ opacity: 0 });
  expect(String(exit.at(-1)!.transform)).toContain("-16px, 0");
  expect(enter[0]).toMatchObject({ opacity: 0 });
  expect(String(enter[0].transform)).toContain("16px, 0");
  expect(enter.at(-1)).toMatchObject({ opacity: 1 });
  // Clicks never turn pages by accident; keys, wheel and swipes do.
  expect(bridge.listeners!.click({} as never)).toBe(true);
});

it("fades chapter replacements but leaves same-chapter updates alone", async () => {
  const animate = fade();
  bridge.listeners!.positionChanged(
    Locator.deserialize({
      href: "chapter.xhtml",
      type: "application/xhtml+xml",
      locations: { progression: 0.5 },
    })!,
  );
  const pool = (
    adapter as unknown as {
      navigator: {
        framePool: { update: (...args: unknown[]) => Promise<void> };
      };
    }
  ).navigator.framePool;
  const locator = (href: string) =>
    Locator.deserialize({ href, type: "application/xhtml+xml" })!;
  await pool.update(undefined, locator("chapter.xhtml"), []);
  expect(animate).not.toHaveBeenCalled();
  expect(bridge.update).toHaveBeenCalledOnce();
  await pool.update(undefined, locator("next.xhtml"), []);
  expect(bridge.update).toHaveBeenCalledTimes(2);
  expect(animate).toHaveBeenCalledTimes(2);
  // Scrolling continues upward into the next chapter.
  expect(String(animate.mock.calls[0][0].at(-1)!.transform)).toContain(
    "0, -16px",
  );
  expect(String(animate.mock.calls[1][0][0].transform)).toContain("0, 16px");
});

it("lays out the first chapter in the saved flow before it is shown", async () => {
  bridge.preferences.mockClear();
  const paged = new EPUBReaderAdapter(document.createElement("div"), {
    location: vi.fn(),
    selection: vi.fn(),
  });
  paged.preferTheme({ ...defaultTheme, epubFlow: "paginated" });
  await paged.open({ id: "paged", type: "epub" } as ReaderDocument);
  expect(bridge.preferences).toHaveBeenCalledWith(
    expect.objectContaining({ scroll: false }),
  );
  await paged.destroy();
});

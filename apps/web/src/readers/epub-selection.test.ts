// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  Decoration,
  DecorationObserver,
  EpubNavigatorListeners,
} from "@readium/navigator";
import type { Annotation, Document as ReaderDocument } from "@reader/core";
import { Locator, Publication } from "@readium/shared";

const bridge = vi.hoisted(() => ({
  listeners: undefined as EpubNavigatorListeners | undefined,
  observer: undefined as DecorationObserver | undefined,
  apply: vi.fn(),
  go: vi.fn(),
  load: vi.fn(),
}));
vi.mock("@readium/navigator", () => ({
  DecorationLayout: { Boxes: "boxes" },
  DecorationWidth: { Wrap: "wrap" },
  EpubNavigator: class {
    constructor(
      _container: HTMLElement,
      _publication: unknown,
      listeners: EpubNavigatorListeners,
    ) {
      bridge.listeners = listeners;
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

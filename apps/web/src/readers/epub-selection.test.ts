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
    async load() {}
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
  targetFrameSrc: frame.src,
});
beforeEach(async () => {
  changed.mockClear();
  activated.mockClear();
  bridge.apply.mockClear();
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
      json: async () => ({
        metadata: { title: "Test book" },
        readingOrder: [
          { href: "chapter.xhtml", type: "application/xhtml+xml" },
        ],
      }),
    }),
  );
  vi.spyOn(Publication.prototype, "positionsFromManifest").mockResolvedValue(
    [],
  );
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
  frame
    .contentDocument!.querySelector("p")!
    .dispatchEvent(
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

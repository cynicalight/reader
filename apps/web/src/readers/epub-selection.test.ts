// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EpubNavigatorListeners } from "@readium/navigator";
import type { Document as ReaderDocument } from "@reader/core";
import { Locator, Publication } from "@readium/shared";

const bridge = vi.hoisted(() => ({
  listeners: undefined as EpubNavigatorListeners | undefined,
}));
vi.mock("@readium/navigator", () => ({
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
  },
}));
import { EPUBReaderAdapter } from "./epub";

let adapter: EPUBReaderAdapter;
let host: HTMLDivElement;
let frame: HTMLIFrameElement;
const changed = vi.fn();
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

// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  AnnotationMode: { ENABLE: 1 },
}));
vi.mock("pdfjs-dist/web/pdf_viewer.mjs", () => ({
  EventBus: class {
    on() {}
    off() {}
  },
  PDFLinkService: class {
    setViewer() {}
  },
  PDFViewer: class {
    setDocument() {}
  },
}));
import { PDFReaderAdapter } from "./pdf";
let adapter: PDFReaderAdapter;
let host: HTMLDivElement;
let changed: Mock<
  (selection: import("@reader/core").ReaderSelection | null) => void
>;
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  changed = vi.fn();
  adapter = new PDFReaderAdapter(host, {
    location: vi.fn(),
    selection: changed,
  });
  host.querySelector(".pdfViewer")!.innerHTML =
    '<div class="page" data-page-number="1"><span>Selected passage</span></div>';
  const page = host.querySelector(".page")!;
  vi.spyOn(page, "getBoundingClientRect").mockReturnValue(
    new DOMRect(20, 40, 600, 800),
  );
  const range = document.createRange();
  range.selectNodeContents(page.firstChild!);
  Object.assign(range, {
    getClientRects: () => [new DOMRect(60, 100, 180, 20)],
  });
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  page.dispatchEvent(
    new MouseEvent("mouseup", { bubbles: true, clientX: 240, clientY: 115 }),
  );
  expect(adapter.getSelection()?.text).toBe("Selected passage");
});
afterEach(async () => {
  await adapter.destroy();
  host.remove();
  window.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
});
it("clears the displayed selection after clicking blank PDF space", () => {
  window.getSelection()!.removeAllRanges();
  host.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  expect(adapter.getSelection()).toBeNull();
  expect(changed).toHaveBeenLastCalledWith(null);
});
it("clears the displayed selection when the browser collapses it without a mouseup", () => {
  window.getSelection()!.removeAllRanges();
  document.dispatchEvent(new Event("selectionchange"));
  expect(adapter.getSelection()).toBeNull();
  expect(changed).toHaveBeenLastCalledWith(null);
});

it("clears native ranges on explicit dismissal so the next mouseup cannot restore the toolbar", () => {
  adapter.clearSelection();
  expect(window.getSelection()!.rangeCount).toBe(0);
  host.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  expect(adapter.getSelection()).toBeNull();
});
it("records the release point near the selected line rather than the reader bottom", () => {
  expect(adapter.getSelection()?.anchor).toEqual({
    x: 240,
    top: 100,
    bottom: 120,
  });
});
it("preserves the selection for toolbar actions but clears it when clicking another panel", () => {
  const toolbar = document.createElement("div");
  toolbar.className = "selection-bar";
  document.body.append(toolbar);
  toolbar.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  expect(adapter.getSelection()?.text).toBe("Selected passage");
  document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  expect(adapter.getSelection()).toBeNull();
  expect(window.getSelection()!.rangeCount).toBe(0);
  toolbar.remove();
});

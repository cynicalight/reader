// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { PDFBlockOverlay } from "./pdf-blocks";
import type { Annotation, PDFBlock } from "@reader/core";
import { PDFAnnotationLayer } from "./pdf-annotations";
import { readFileSync } from "node:fs";

let host: HTMLDivElement;
let text: HTMLSpanElement;
let layer: PDFAnnotationLayer;
const activate = vi.fn();
const annotation = (
  id: string,
  kind: Annotation["kind"] = "highlight",
): Annotation => ({
  id,
  kind,
  documentId: "book",
  quote: "Marked text",
  note: "",
  color: "#e6b94c",
  createdAt: "",
  location: {
    type: "pdf",
    page: 1,
    rects: [
      { x: 0.1, y: 0.1, width: 0.3, height: 0.05 },
      { x: 0.1, y: 0.2, width: 0.2, height: 0.05 },
    ],
  },
});
function pointer(
  type: string,
  extra: MouseEventInit = {},
  target: EventTarget = text,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: 130,
    ...extra,
  });
  target.dispatchEvent(event);
  return event;
}
beforeEach(() => {
  activate.mockClear();
  host = document.createElement("div");
  host.innerHTML =
    '<div class="page" data-page-number="1"><span>Marked text</span><a href="#">Link</a></div>';
  document.body.append(host);
  text = host.querySelector("span")!;
  vi.spyOn(host.firstElementChild!, "getBoundingClientRect").mockReturnValue(
    new DOMRect(20, 40, 600, 800),
  );
  layer = new PDFAnnotationLayer(host, activate);
  layer.setAnnotations([
    annotation("highlight"),
    annotation("note", "note"),
    annotation("underline", "underline"),
  ]);
});
afterEach(() => {
  layer.destroy();
  host.remove();
  window.getSelection()?.removeAllRanges();
});
it("highlights all lines of overlapping annotations, but not gaps between lines", () => {
  pointer("pointermove");
  expect(host.querySelectorAll("[data-hovered]")).toHaveLength(6);
  pointer("pointermove", { clientY: 185 });
  expect(host.querySelectorAll("[data-hovered]")).toHaveLength(0);
  pointer("pointermove");
  host.dispatchEvent(new Event("pointerleave"));
  expect(host.querySelectorAll("[data-hovered]")).toHaveLength(0);
});
it("opens all overlapping records at the clicked line and removes only deleted markers", () => {
  pointer("pointerdown");
  expect(pointer("click").defaultPrevented).toBe(true);
  expect(activate).toHaveBeenCalledExactlyOnceWith({
    ids: ["highlight", "note", "underline"],
    anchor: { x: 100, top: 120, bottom: 160 },
  });
  layer.setAnnotations([annotation("note", "note")]);
  expect(host.querySelectorAll(".reader-highlight")).toHaveLength(2);
  expect(host.querySelector('[data-annotation-id="highlight"]')).toBeNull();
  // A PDF.js page rerender must not resurrect a deleted annotation.
  layer.paint();
  expect(host.querySelectorAll(".reader-highlight")).toHaveLength(2);
});
it("composites overlapping rectangles once per annotation, including on hover and repaint", () => {
  // Use the production rules: per-rectangle opacity would darken this overlap.
  const style = document.createElement("style");
  style.textContent = readFileSync("apps/web/src/style.css", "utf8")
    .match(/\.reader-(?:annotation|highlight)[^{]*\{[^}]*\}/g)!
    .join("\n");
  document.head.append(style);
  const mark = annotation("overlap");
  if (mark.location.type !== "pdf") throw new Error("Expected PDF location");
  mark.location.rects = [
    { x: 0.1, y: 0.1, width: 0.3, height: 0.05 },
    { x: 0.2, y: 0.1, width: 0.3, height: 0.05 },
    { x: 0.1, y: 0.1, width: 0.3, height: 0.05 },
  ];
  try {
    layer.setAnnotations([mark]);
    const assertSingleComposite = (opacity: string) => {
      const rects = [
        ...host.querySelectorAll<HTMLElement>(".reader-highlight"),
      ];
      expect(rects).toHaveLength(3);
      const group = rects[0].parentElement!;
      expect(group).not.toBe(host.firstElementChild);
      expect(rects.every((rect) => rect.parentElement === group)).toBe(true);
      expect(getComputedStyle(group).opacity).toBe(opacity);
      expect(getComputedStyle(group).mixBlendMode).toBe("multiply");
      for (const rect of rects) {
        expect(["", "1"]).toContain(getComputedStyle(rect).opacity);
        expect(["", "normal"]).toContain(getComputedStyle(rect).mixBlendMode);
      }
    };
    assertSingleComposite("0.32");
    pointer("pointermove");
    assertSingleComposite("0.48");
    layer.paint();
    assertSingleComposite("0.32");
    expect(host.querySelectorAll(".reader-annotation")).toHaveLength(1);
    layer.setAnnotations([]);
    expect(host.querySelector(".reader-annotation")).toBeNull();
  } finally {
    style.remove();
  }
});
it("leaves dragging, text selection and native links untouched", () => {
  pointer("pointerdown");
  expect(pointer("click", { clientX: 115 }).defaultPrevented).toBe(false);
  pointer("pointerdown");
  const range = document.createRange();
  range.selectNodeContents(text);
  window.getSelection()!.addRange(range);
  pointer("pointermove");
  expect(host.querySelectorAll("[data-hovered]")).toHaveLength(0);
  expect(pointer("click").defaultPrevented).toBe(false);
  window.getSelection()!.removeAllRanges();
  pointer("pointerdown", {}, host.querySelector("a")!);
  expect(pointer("click", {}, host.querySelector("a")!).defaultPrevented).toBe(
    false,
  );
  expect(activate).not.toHaveBeenCalled();
});
it("discards gestures on scroll and detaches listeners on disposal", () => {
  pointer("pointerdown");
  host.dispatchEvent(new Event("scroll"));
  pointer("click");
  layer.destroy();
  pointer("pointerdown");
  pointer("click");
  expect(activate).not.toHaveBeenCalled();
  expect(host.querySelector(".reader-highlight")).toBeNull();
});

it("keeps block and annotation hover active together, with independent hit regions", async () => {
  const block: PDFBlock = {
    id: "paragraph",
    page: 1,
    label: "paragraph",
    text: "Marked text and surrounding paragraph",
    bounds: { x: 0.05, y: 0.05, width: 0.8, height: 0.4 },
  };
  const hover = vi.fn();
  const action = vi.fn();
  const blocks = new PDFBlockOverlay(host, action, hover);
  blocks.setBlocks([block]);
  try {
    await act(async () => {
      pointer("pointermove");
    });
    expect(
      host.querySelectorAll(".reader-highlight[data-hovered]"),
    ).toHaveLength(6);
    expect(
      host.querySelector(".reader-block-hover")?.getAttribute("data-block-id"),
    ).toBe(block.id);
    expect(hover).toHaveBeenLastCalledWith(block);

    // Move into the unmarked space in the same paragraph.
    await act(async () => {
      pointer("pointermove", { clientY: 185 });
    });
    expect(
      host.querySelectorAll(".reader-highlight[data-hovered]"),
    ).toHaveLength(0);
    expect(host.querySelector(".reader-block-hover")).not.toBeNull();
    expect(hover).toHaveBeenCalledTimes(1);

    await act(async () => {
      pointer("pointermove");
    });
    pointer("pointerdown");
    pointer("click");
    expect(activate).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();

    host.dispatchEvent(new Event("pointerleave"));
    expect(
      host.querySelectorAll(".reader-highlight[data-hovered]"),
    ).toHaveLength(0);
    expect(host.querySelector(".reader-block-hover")).toBeNull();
    expect(hover).toHaveBeenLastCalledWith(null);
  } finally {
    await act(async () => blocks.destroy());
  }
});

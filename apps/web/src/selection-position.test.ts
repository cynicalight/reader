// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { toolbarPosition } from "./SelectionToolbar";
import { selectionAnchor } from "./readers/selection-anchor";
it("places the toolbar next to the release point and flips above the bottom edge", () => {
  const pane = { left: 300, top: 60, right: 1000, bottom: 800 };
  const size = { width: 340, height: 44 };
  expect(
    toolbarPosition({ x: 700, top: 200, bottom: 220 }, pane, size),
  ).toEqual({ left: 230, top: 170 });
  expect(
    toolbarPosition({ x: 990, top: 760, bottom: 780 }, pane, size),
  ).toEqual({ left: 352, top: 646 });
  expect(
    toolbarPosition({ x: 301, top: 70, bottom: 90 }, pane, size).left,
  ).toBe(8);
});
it("uses the focus end for reversed selections and translates EPUB iframe coordinates", () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const doc = frame.contentDocument!;
  doc.body.innerHTML = "<p>Selected text</p>";
  const text = doc.querySelector("p")!.firstChild!;
  const range = doc.createRange();
  range.selectNodeContents(text);
  Object.assign(range, {
    getClientRects: () => [
      new DOMRect(40, 30, 100, 20),
      new DOMRect(40, 50, 160, 20),
    ],
  });
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(
    new DOMRect(300, 60, 600, 800),
  );
  Object.defineProperty(frame, "offsetWidth", { value: 600 });
  Object.defineProperty(frame, "offsetHeight", { value: 800 });
  const selected = {
    rangeCount: 1,
    isCollapsed: false,
    getRangeAt: () => range,
    focusNode: text,
    focusOffset: 0,
  } as unknown as Selection;
  expect(selectionAnchor(selected, undefined, frame)).toEqual({
    x: 340,
    top: 90,
    bottom: 110,
  });
  expect(selectionAnchor(selected, { x: 180, y: 62 }, frame)).toEqual({
    x: 480,
    top: 110,
    bottom: 130,
  });
  frame.remove();
});

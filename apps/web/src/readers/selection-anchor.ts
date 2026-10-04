import type { SelectionAnchor } from "@reader/core";

// Coordinates are in the renderer viewport, including selections inside EPUB frames.
export function selectionAnchor(
  selection: Selection,
  pointer?: { x: number; y: number },
  frame?: HTMLIFrameElement,
): SelectionAnchor | undefined {
  if (!selection.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const rects = Array.from(range.getClientRects()).filter(
    (r) => r.height > 0 && r.width > 0,
  );
  if (!rects.length) return;
  const backwards =
    selection.focusNode === range.startContainer &&
    selection.focusOffset === range.startOffset;
  let rect = backwards ? rects[0]! : rects[rects.length - 1]!;
  let x = backwards ? rect.left : rect.right;
  if (pointer) {
    const distance = (r: DOMRect) =>
      Math.hypot(
        Math.max(r.left - pointer.x, 0, pointer.x - r.right),
        Math.max(r.top - pointer.y, 0, pointer.y - r.bottom),
      );
    rect = rects.reduce((nearest, candidate) =>
      distance(candidate) < distance(nearest) ? candidate : nearest,
    );
    x = pointer.x;
  }
  const frameRect = frame?.getBoundingClientRect();
  const scaleX =
    frameRect && frame?.offsetWidth ? frameRect.width / frame.offsetWidth : 1;
  const scaleY =
    frameRect && frame?.offsetHeight
      ? frameRect.height / frame.offsetHeight
      : 1;
  return {
    x: (frameRect?.left ?? 0) + ((frame?.clientLeft ?? 0) + x) * scaleX,
    top: (frameRect?.top ?? 0) + ((frame?.clientTop ?? 0) + rect.top) * scaleY,
    bottom:
      (frameRect?.top ?? 0) + ((frame?.clientTop ?? 0) + rect.bottom) * scaleY,
  };
}
export function isSelectionToolbar(target: EventTarget | null) {
  return target instanceof Element && !!target.closest(".selection-bar");
}

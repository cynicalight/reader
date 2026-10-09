import type { PointerEvent as ReactPointerEvent } from "react";
import type { PaperColumn } from "@reader/core";

/** Keyboard step for resize separators, in CSS pixels. */
export const resizeStep = 16;
export const detailWidthRange = { min: 280, max: 720 };
const minWidth = (column: "title" | PaperColumn) =>
  column === "title" ? 160 : 48;

/**
 * Follows a horizontal drag from a resize handle until release. The page keeps
 * the resize cursor and does not select text while dragging.
 */
export function dragHorizontally(
  event: ReactPointerEvent<HTMLElement>,
  move: (dx: number) => void,
  end: () => void,
) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget,
    start = event.clientX;
  handle.setPointerCapture?.(event.pointerId);
  document.body.dataset.resizing = "";
  const onMove = (e: PointerEvent) => move(e.clientX - start);
  const finish = () => {
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", finish);
    handle.removeEventListener("pointercancel", finish);
    delete document.body.dataset.resizing;
    end();
  };
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
}

/**
 * Moves the boundary between two adjacent columns by dx. The table fills its
 * width and the title column takes whatever the fixed columns leave, so only
 * fixed columns get stored widths; the boundary follows the pointer exactly.
 */
export function resizeBoundary(
  widths: Partial<Record<"title" | PaperColumn, number>>,
  left: "title" | PaperColumn,
  right: PaperColumn,
  dx: number,
): Partial<Record<PaperColumn, number>> {
  const l = widths[left] ?? 0,
    r = widths[right] ?? 0;
  const moved = Math.round(
    Math.min(Math.max(dx, minWidth(left) - l), r - minWidth(right)),
  );
  return left === "title"
    ? { [right]: r - moved }
    : { [left]: l + moved, [right]: r - moved };
}

export const clampDetailWidth = (width: number) =>
  Math.round(
    Math.min(detailWidthRange.max, Math.max(detailWidthRange.min, width)),
  );

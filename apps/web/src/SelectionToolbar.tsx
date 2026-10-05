import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { SelectionAnchor } from "@reader/core";

export function toolbarPosition(
  anchor: SelectionAnchor,
  pane: { left: number; top: number; right: number; bottom: number },
  size: { width: number; height: number },
) {
  const gap = 10;
  const left = Math.max(
    pane.left + 8,
    Math.min(anchor.x - size.width / 2, pane.right - size.width - 8),
  );
  const below = anchor.bottom + gap;
  const top = Math.max(
    pane.top + 8,
    Math.min(
      below + size.height <= pane.bottom - 8
        ? below
        : anchor.top - gap - size.height,
      pane.bottom - size.height - 8,
    ),
  );
  return { left: left - pane.left, top: top - pane.top };
}
export function SelectionToolbar({
  anchor,
  pane,
  children,
  label = "选中文字操作",
}: {
  anchor: SelectionAnchor;
  pane: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  label?: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>();
  useLayoutEffect(() => {
    if (!bar.current || !pane.current) return;
    const update = () => {
      if (bar.current && pane.current)
        setPosition(
          toolbarPosition(
            anchor,
            pane.current.getBoundingClientRect(),
            bar.current.getBoundingClientRect(),
          ),
        );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(pane.current);
    observer.observe(bar.current);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [anchor, pane]);
  return (
    <div
      ref={bar}
      className="selection-bar"
      role="toolbar"
      aria-label={label}
      style={{ ...position, visibility: position ? "visible" : "hidden" }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {children}
    </div>
  );
}

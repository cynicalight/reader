import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BlockActions } from "../BlockActions";
import type { PDFBlock, PDFBlockAction } from "@reader/core";
export function hitBlock(
  blocks: PDFBlock[],
  page: number,
  x: number,
  y: number,
) {
  return blocks
    .filter(
      (b) =>
        b.page === page &&
        (b.image || b.text.trim()) &&
        x >= b.bounds.x &&
        y >= b.bounds.y &&
        x <= b.bounds.x + b.bounds.width &&
        y <= b.bounds.y + b.bounds.height,
    )
    .sort(
      (a, b) =>
        a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height,
    )[0];
}
// Pointer observation leaves the PDF text and links as the event targets.
export class PDFBlockOverlay {
  private blocks: PDFBlock[] = [];
  private overlay: HTMLDivElement;
  private root: Root;
  private active?: PDFBlock;
  private pressed?: { id: string; x: number; y: number };
  constructor(
    private host: HTMLElement,
    private onAction: (
      block: PDFBlock,
      action: PDFBlockAction,
    ) => void = () => {},
  ) {
    this.overlay = document.createElement("div");
    this.overlay.className = "reader-block-hover";
    this.root = createRoot(this.overlay);
    host.addEventListener("pointermove", this.move);
    host.addEventListener("pointerleave", this.clear);
    host.addEventListener("pointerdown", this.press);
    host.addEventListener("click", this.click, true);
    host.addEventListener("pointerup", this.move);
    host.addEventListener("scroll", this.clear, { passive: true });
  }
  setBlocks(blocks: PDFBlock[]) {
    this.blocks = blocks;
    this.clear();
  }
  clear = () => {
    this.pressed = undefined;
    this.overlay.remove();
  };
  private press = (event: PointerEvent) => {
    this.pressed = undefined;
    if (
      (event.target as Element)?.closest("[data-block-action]") ||
      event.button !== 0
    )
      return;
    const block = this.find(event);
    if (block)
      this.pressed = { id: block.id, x: event.clientX, y: event.clientY };
  };
  private click = (event: MouseEvent) => {
    if ((event.target as Element)?.closest("[data-block-action]")) return;
    const pressed = this.pressed;
    this.pressed = undefined;
    if (
      !pressed ||
      Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 5 ||
      window.getSelection()?.toString().trim()
    )
      return;
    const block = this.find(event);
    if (block?.id !== pressed.id || !block.image) return;
    event.preventDefault();
    event.stopPropagation();
    this.onAction(block, "attach");
  };
  private find(event: MouseEvent) {
    const page = (event.target as Element | null)?.closest<HTMLElement>(
      ".page[data-page-number]",
    );
    if (!page || !this.host.contains(page)) return;
    const rect = page.getBoundingClientRect();
    return hitBlock(
      this.blocks,
      Number(page.dataset.pageNumber),
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    );
  }
  private move = (event: PointerEvent) => {
    if ((event.target as Element | null)?.closest("[data-block-action]"))
      return;
    if (event.buttons || window.getSelection()?.toString().trim()) {
      this.clear();
      return;
    }
    const page = (event.target as Element | null)?.closest<HTMLElement>(
      ".page[data-page-number]",
    );
    if (!page || !this.host.contains(page)) {
      this.clear();
      return;
    }
    const rect = page.getBoundingClientRect();
    const block = hitBlock(
      this.blocks,
      Number(page.dataset.pageNumber),
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    );
    if (!block) {
      this.clear();
      return;
    }
    if (this.active !== block) {
      this.active = block;
      this.root.render(
        createElement(BlockActions, { block, onAction: this.onAction }),
      );
    }
    const b = block.bounds;
    this.overlay.toggleAttribute("data-compact", b.height * rect.height < 72);
    Object.assign(this.overlay.style, {
      left: `${b.x * 100}%`,
      top: `${b.y * 100}%`,
      width: `${b.width * 100}%`,
      height: `${b.height * 100}%`,
    });
    this.overlay.dataset.blockId = block.id;
    if (this.overlay.parentElement !== page) page.append(this.overlay);
  };
  destroy() {
    this.clear();
    this.root.unmount();
    this.host.removeEventListener("pointermove", this.move);
    this.host.removeEventListener("pointerleave", this.clear);
    this.host.removeEventListener("pointerdown", this.press);
    this.host.removeEventListener("click", this.click, true);
    this.host.removeEventListener("pointerup", this.move);
    this.host.removeEventListener("scroll", this.clear);
  }
}

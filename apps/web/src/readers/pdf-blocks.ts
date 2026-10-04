import type { PDFBlock } from "@reader/core";
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
        b.image &&
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
  constructor(private host: HTMLElement) {
    this.overlay = document.createElement("div");
    this.overlay.className = "reader-block-hover";
    this.overlay.setAttribute("aria-hidden", "true");
    host.addEventListener("pointermove", this.move);
    host.addEventListener("pointerleave", this.clear);
    host.addEventListener("pointerdown", this.clear);
    host.addEventListener("pointerup", this.move);
    host.addEventListener("scroll", this.clear, { passive: true });
  }
  setBlocks(blocks: PDFBlock[]) {
    this.blocks = blocks;
    this.clear();
  }
  clear = () => {
    this.overlay.remove();
  };
  private move = (event: PointerEvent) => {
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
    const b = block.bounds;
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
    this.host.removeEventListener("pointermove", this.move);
    this.host.removeEventListener("pointerleave", this.clear);
    this.host.removeEventListener("pointerdown", this.clear);
    this.host.removeEventListener("pointerup", this.move);
    this.host.removeEventListener("scroll", this.clear);
  }
}

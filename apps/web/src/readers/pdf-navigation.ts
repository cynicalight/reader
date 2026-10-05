import { animatePDFScroll } from "./pdf-scroll";
import { sentenceTextRanges } from "./pdf-sentence-matching";
import * as pdfjs from "pdfjs-dist";
import type { PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import { isPDFPageDecoration, pdfFontAscent } from "@reader/core";
import type {
  PDFBlock,
  PDFReadingAnchor,
  ReaderEvents,
  PDFLocation,
  PDFPassage,
  PDFSentenceLink,
  TranslationBlock,
} from "@reader/core";
import {
  ColumnGesture,
  columnReadingScale,
  overlap,
  readingColumns,
  type Box,
  type TextRun,
} from "./pdf-reading";

export class PDFReadingNavigation {
  private cache = new Map<number, Promise<TextRun[]>>();
  private active = false;
  private moving = false;
  private disposed = false;
  private frame = 0;
  private operation = 0;
  private lastLeft = 0;
  private lastTop = 0;
  private scrollDelta = 0;
  private readingBlock?: string;
  private wheelDirection = 0;
  private wheelFresh = false;
  private gesture = new ColumnGesture();
  private focus: PDFPassage[] = [];
  private linkedRanges: Range[] = [];
  constructor(
    private host: HTMLElement,
    private viewer: PDFViewer,
    private page: (n: number) => Promise<pdfjs.PDFPageProxy>,
    private count: () => number,
    private blocks: () => PDFBlock[],
    private events: ReaderEvents,
    private onFocus: (blockId: string | null) => void = () => {},
  ) {
    host.addEventListener("pointerdown", this.interrupt);
    host.addEventListener("scroll", this.scrolled, { passive: true });
    host.addEventListener("wheel", this.wheel, { passive: false });
  }
  get fitted() {
    return this.active;
  }
  private interrupt = () => {
    this.operation++;
    this.moving = false;
    this.wheelDirection = 0;
  };
  private async moveTo(
    left: number,
    top: number,
    operation: number,
    immediate = false,
  ) {
    this.moving = true;
    try {
      await animatePDFScroll(
        this.host,
        left,
        top,
        () => this.disposed || operation !== this.operation,
        () => {
          this.lastLeft = this.host.scrollLeft;
          this.lastTop = this.host.scrollTop;
        },
        immediate,
      );
    } finally {
      if (operation === this.operation) {
        this.moving = false;
        this.scrolled();
      }
    }
  }
  async goTo(page: number, point?: { x: number; y: number }) {
    const operation = ++this.operation;
    if (this.active) {
      const blocks = this.readableBlocks().filter((b) => b.page === page);
      const target = point
        ? (blocks.find(
            (b) =>
              point.x >= b.bounds.x &&
              point.x <= b.bounds.x + b.bounds.width &&
              point.y >= b.bounds.y &&
              point.y <= b.bounds.y + b.bounds.height,
          ) ??
          blocks.reduce<PDFBlock | undefined>(
            (best, b) =>
              !best ||
              Math.abs(b.bounds.y - point.y) < Math.abs(best.bounds.y - point.y)
                ? b
                : best,
            undefined,
          ))
        : blocks[0];
      if (target) return this.placeBlock(target);
      const columns = await this.columns(page);
      if (this.disposed || operation !== this.operation) return false;
      if (columns.length) {
        const index = point
          ? Math.max(
              0,
              columns.findIndex(
                (b) =>
                  point.x >= b.x &&
                  point.x <= b.x + b.width &&
                  point.y >= b.y &&
                  point.y <= b.y + b.height,
              ),
            )
          : 0;
        return this.placeRegion(page, columns[index], point?.y);
      }
    }
    const node = this.pageNode(page);
    if (!node || this.disposed || operation !== this.operation) return false;
    this.setReadingBlock(undefined);
    const r = node.getBoundingClientRect(),
      v = this.host.getBoundingClientRect();
    await this.moveTo(
      this.host.scrollLeft + r.left - v.left + (point?.x ?? 0) * r.width,
      this.host.scrollTop + r.top - v.top + (point?.y ?? 0) * r.height - 24,
      operation,
    );
    return !this.disposed && operation === this.operation;
  }
  private async runs(page: number) {
    if (!this.cache.has(page))
      this.cache.set(
        page,
        (async () => {
          const p = await this.page(page),
            viewport = p.getViewport({ scale: 1 }),
            text = await p.getTextContent();
          return text.items.flatMap((item) => {
            if (!("str" in item) || !item.str.trim()) return [];
            const tr = pdfjs.Util.transform(viewport.transform, item.transform),
              h = Math.hypot(tr[2], tr[3]);
            return [
              {
                text: item.str,
                bounds: {
                  x: tr[4] / viewport.width,
                  y:
                    (tr[5] - h * pdfFontAscent(text.styles[item.fontName])) /
                    viewport.height,
                  width: Math.abs(item.width) / viewport.width,
                  height: h / viewport.height,
                },
              },
            ];
          });
        })(),
      );
    return this.cache.get(page)!;
  }
  private async columns(page: number) {
    const [runs, ...neighbors] = await Promise.all(
      [page, page - 1, page + 1]
        .filter((n) => n >= 1 && n <= this.count())
        .map((n) => this.runs(n)),
    );
    return readingColumns(
      runs,
      this.blocks().filter((b) => b.page === page),
      neighbors.flat(),
    );
  }
  private pageNode(n: number) {
    return this.viewer.getPageView(n - 1)?.div as HTMLElement | undefined;
  }
  private scrolled = () => {
    if (!this.moving && Math.abs(this.host.scrollLeft - this.lastLeft) > 3)
      this.stop();
    this.lastLeft = this.host.scrollLeft;
    this.scrollDelta += this.host.scrollTop - this.lastTop;
    this.lastTop = this.host.scrollTop;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      const delta = this.scrollDelta;
      this.scrollDelta = 0;
      if (this.disposed || this.moving) return;
      if (this.active && delta) {
        if (this.wheelDirection && this.wheelFresh) {
          if (this.advanceAtBoundary(this.wheelDirection)) return;
        } else if (!this.wheelDirection) {
          // Scrollbar / keyboard scrolling changes focus without snapping back.
          const nearest = this.anchor(false);
          if (nearest) this.setReadingBlock(nearest.blockId);
        }
      }
      const anchor = this.anchor();
      if (anchor) this.events.readingAnchor?.(anchor);
    });
  };
  anchor(useFocus = true): PDFReadingAnchor | undefined {
    const viewport = this.host.getBoundingClientRect(),
      y = viewport.top + viewport.height * (this.active ? 0.5 : 0.3),
      x = viewport.left + viewport.width / 2;
    let best: PDFBlock | undefined,
      distance = Infinity,
      fraction = 0;
    const focused =
      useFocus && this.active
        ? this.readableBlocks().find((b) => b.id === this.readingBlock)
        : undefined;
    for (const b of focused ? [focused] : this.readableBlocks()) {
      const node = this.pageNode(b.page);
      if (!node) continue;
      const r = node.getBoundingClientRect();
      if (!focused && (r.bottom < viewport.top || r.top > viewport.bottom))
        continue;
      const bx = r.left + b.bounds.x * r.width,
        by = r.top + b.bounds.y * r.height,
        bw = b.bounds.width * r.width,
        bh = b.bounds.height * r.height;
      const d =
        Math.max(bx - x, x - bx - bw, 0) * 2 + Math.max(by - y, y - by - bh, 0);
      if (d < distance) {
        distance = d;
        best = b;
        fraction = Math.max(0, Math.min(1, (y - by) / (bh || 1)));
      }
    }
    return best ? { blockId: best.id, fraction } : undefined;
  }
  stop() {
    this.operation++;
    this.moving = false;
    const wasActive = this.active;
    this.active = false;
    this.wheelDirection = 0;
    this.setReadingBlock(undefined);
    if (!wasActive && !this.host.classList.contains("pdf-block-reading"))
      return;
    const page = this.pageNode(this.viewer.currentPageNumber);
    const before = page?.getBoundingClientRect();
    this.host.classList.remove("pdf-block-reading");
    if (page && before) {
      const after = page.getBoundingClientRect();
      this.host.scrollLeft += after.left - before.left;
      this.host.scrollTop += after.top - before.top;
    }
    this.lastLeft = this.host.scrollLeft;
    this.lastTop = this.host.scrollTop;
    if (wasActive) this.events.columnFit?.(false);
  }
  async fit(resetScale = true) {
    const operation = ++this.operation;
    const anchor = this.anchor(),
      block = this.blocks().find((b) => b.id === anchor?.blockId);
    const page = block?.page ?? this.viewer.currentPageNumber;
    const columns = await this.columns(page);
    if (this.disposed || operation !== this.operation) return;
    if (!columns.length) {
      this.stop();
      return;
    }
    const scale = resetScale
      ? columnReadingScale(
          columns,
          this.host.clientWidth,
          (await this.page(page)).getViewport({ scale: 1 }).width,
        )
      : undefined;
    if (this.disposed || operation !== this.operation) return;
    this.host.style.setProperty(
      "--reading-inset-x",
      `${this.host.clientWidth / 2}px`,
    );
    this.host.style.setProperty(
      "--reading-inset-y",
      `${this.host.clientHeight / 2}px`,
    );
    this.host.classList.add("pdf-block-reading");
    if (block) {
      await this.placeBlock(
        block,
        false,
        scale,
        resetScale ? undefined : anchor?.fraction,
      );
      return;
    }
    const node = this.pageNode(page),
      view = this.host.getBoundingClientRect(),
      r = node?.getBoundingClientRect();
    const point = {
      x: r ? (view.left + view.width / 2 - r.left) / r.width : 0,
      y: r ? (view.top + view.height * 0.3 - r.top) / r.height : 0,
      width: 0,
      height: 0,
    };
    const index =
      columns
        .map((b, i) => ({
          i,
          d:
            Math.max(b.x - point.x, point.x - b.x - b.width, 0) +
            Math.max(b.y - point.y, point.y - b.y - b.height, 0),
        }))
        .sort((a, b) => a.d - b.d)[0]?.i ?? 0;
    await this.placeRegion(page, columns[index], undefined, scale);
  }
  private async placeRegion(
    page: number,
    bounds: Box,
    targetY?: number,
    scale?: number,
  ) {
    const operation = ++this.operation;
    this.moving = true;
    this.active = true;
    this.setReadingBlock(undefined);
    try {
      if (
        scale !== undefined &&
        Math.abs(this.viewer.currentScale - scale) > 0.002
      )
        this.viewer.currentScaleValue = String(scale);
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      );
      if (this.disposed || operation !== this.operation) return false;
      const node = this.pageNode(page);
      if (!node) return false;
      const r = node.getBoundingClientRect(),
        v = this.host.getBoundingClientRect();
      await this.moveTo(
        this.host.scrollLeft +
          r.left -
          v.left +
          (bounds.x + bounds.width / 2) * r.width -
          this.host.clientWidth / 2,
        this.host.scrollTop +
          r.top -
          v.top +
          (targetY ?? bounds.y) * r.height -
          (targetY !== undefined ? this.host.clientHeight * 0.3 : 24),
        operation,
      );
      if (this.disposed || operation !== this.operation) return false;
      this.events.columnFit?.(true);
      return true;
    } finally {
      if (operation === this.operation) {
        this.moving = false;
        this.scrolled();
      }
    }
  }
  private readableBlocks() {
    // The parser supplies reading order within each page, including figures.
    return this.blocks()
      .filter((b) => !isPDFPageDecoration(b) && (b.image || b.text.trim()))
      .sort((a, b) => a.page - b.page);
  }
  private setReadingBlock(id?: string) {
    this.readingBlock = id;
    this.onFocus(id ?? null);
  }
  focusBlock(id: string) {
    if (!this.active || this.disposed) return false;
    const block = this.readableBlocks().find((b) => b.id === id);
    if (!block) return false;
    this.gesture = new ColumnGesture();
    void this.placeBlock(block, true).catch(() => this.stop());
    return true;
  }
  private async placeBlock(
    block: PDFBlock,
    immediate = false,
    scale?: number,
    fraction?: number,
  ) {
    const operation = ++this.operation;
    this.moving = true;
    this.wheelDirection = 0;
    this.scrollDelta = 0;
    try {
      if (
        scale !== undefined &&
        Math.abs(this.viewer.currentScale - scale) > 0.002
      ) {
        this.viewer.currentScaleValue = String(scale);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }
      if (this.disposed || operation !== this.operation) return false;
      const node = this.pageNode(block.page);
      if (!node) return false;
      this.active = true;
      this.setReadingBlock(block.id);
      const r = node.getBoundingClientRect(),
        v = this.host.getBoundingClientRect();
      const height = block.bounds.height * r.height;
      const top =
        this.host.scrollTop + r.top - v.top + block.bounds.y * r.height;
      await this.moveTo(
        this.host.scrollLeft +
          r.left -
          v.left +
          (block.bounds.x + block.bounds.width / 2) * r.width -
          this.host.clientWidth / 2,
        fraction === undefined
          ? top - Math.max(0, (this.host.clientHeight - height) / 2)
          : top + fraction * height - this.host.clientHeight / 2,
        operation,
        immediate,
      );
      if (this.disposed || operation !== this.operation) return false;
      this.events.columnFit?.(true);
      const anchor = this.anchor();
      if (anchor) this.events.readingAnchor?.(anchor);
      return true;
    } finally {
      if (operation === this.operation) this.moving = false;
    }
  }
  async stepBlock(direction: number) {
    if (!this.active || this.disposed || !direction) return;
    const blocks = this.readableBlocks();
    const index = blocks.findIndex((b) => b.id === this.readingBlock);
    const next = blocks[index + Math.sign(direction)];
    if (index < 0 || !next) return;
    await this.placeBlock(next);
  }
  private advanceAtBoundary(direction: number) {
    const blocks = this.readableBlocks();
    const index = blocks.findIndex((b) => b.id === this.readingBlock);
    const block = blocks[index];
    if (!block || !blocks[index + direction]) return false;
    const node = this.pageNode(block.page);
    if (!node) return false;
    const r = node.getBoundingClientRect(),
      v = this.host.getBoundingClientRect();
    const top = r.top + block.bounds.y * r.height;
    const bottom = top + block.bounds.height * r.height;
    if (
      direction > 0 ? bottom > v.top + v.height / 2 : top < v.top + v.height / 2
    )
      return false;
    this.gesture.transition();
    this.wheelFresh = false;
    void this.stepBlock(direction).catch(() => this.stop());
    return true;
  }
  private wheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) return;
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey) {
      this.stop();
      return;
    }
    if (!this.active) {
      this.interrupt();
      return;
    }
    if (!event.deltaY) return;
    this.wheelFresh = this.gesture.accept(performance.now());
    if (this.moving || !this.wheelFresh) {
      event.preventDefault();
      return;
    }
    this.wheelDirection = Math.sign(event.deltaY);
    if (this.advanceAtBoundary(this.wheelDirection)) event.preventDefault();
  };
  async follow(anchor: PDFReadingAnchor) {
    const block = this.blocks().find((b) => b.id === anchor.blockId);
    if (!block || isPDFPageDecoration(block)) return;
    const operation = ++this.operation;
    if (this.active) {
      await this.placeBlock(block, false, undefined, anchor.fraction);
    } else {
      const node = this.pageNode(block.page);
      if (!node) return;
      const r = node.getBoundingClientRect(),
        v = this.host.getBoundingClientRect();
      let left = this.host.scrollLeft;
      const x = r.left + block.bounds.x * r.width;
      if (x > v.right || x + block.bounds.width * r.width < v.left)
        left += x - v.left - 16;
      await this.moveTo(
        left,
        this.host.scrollTop +
          r.top -
          v.top +
          (block.bounds.y + anchor.fraction * block.bounds.height) * r.height -
          this.host.clientHeight * 0.3,
        operation,
      );
    }
  }
  focusSentences(blockId: string, sources: string[], scroll = false) {
    return this.focusPassages(
      sources.length ? [{ blockId, sources }] : [],
      scroll,
    );
  }
  async focusPassages(passages: PDFPassage[], scroll = false) {
    if (this.disposed) return;
    this.focus = passages;
    this.paintFocus();
    const first = passages[0];
    if (!scroll || !first) return;
    const block = this.blocks().find((b) => b.id === first.blockId);
    if (!block) return;
    const node = this.pageNode(block.page);
    const top = node
      ? this.domSentenceBoxes(node, block, first.sources, first.sourceOffset)[0]
          ?.y
      : undefined;
    // An unrendered sentence can still scroll to its paragraph. It must never
    // use that paragraph's bounds as the visible sentence highlight.
    await this.follow({
      blockId: block.id,
      fraction: Math.max(
        0,
        Math.min(
          1,
          ((top ?? block.bounds.y) - block.bounds.y) /
            (block.bounds.height || 1),
        ),
      ),
    });
    if (!this.disposed && this.focus === passages) this.paintFocus();
  }
  private clearLinkedRanges() {
    const registry = typeof CSS !== "undefined" ? CSS.highlights : undefined;
    const highlight = registry?.get("reader-linked-sentences");
    if (highlight) {
      for (const range of this.linkedRanges) highlight.delete(range);
      if (!highlight.size) registry!.delete("reader-linked-sentences");
    }
    this.linkedRanges = [];
  }
  private paintFocus() {
    this.clearLinkedRanges();
    if (
      this.disposed ||
      typeof Highlight === "undefined" ||
      typeof CSS === "undefined" ||
      !CSS.highlights
    )
      return;
    for (const passage of this.focus) {
      const block = this.blocks().find((b) => b.id === passage.blockId);
      if (!block || !passage.sources.length) continue;
      const node = this.pageNode(block.page);
      if (!node) continue;
      this.linkedRanges.push(
        ...this.domSentenceRanges(
          node,
          block,
          passage.sources,
          passage.sourceOffset,
        ),
      );
    }
    if (!this.linkedRanges.length) return;
    const highlight =
      CSS.highlights.get("reader-linked-sentences") ?? new Highlight();
    for (const range of this.linkedRanges) highlight.add(range);
    CSS.highlights.set("reader-linked-sentences", highlight);
  }
  async matchSentences(
    location: PDFLocation,
    translations: TranslationBlock[],
  ): Promise<PDFSentenceLink[]> {
    const selection = location.rects ?? [],
      result: PDFSentenceLink[] = [];
    for (const block of this.blocks()) {
      if (isPDFPageDecoration(block)) continue;
      if (
        block.page !== location.page ||
        !selection.some((r) => overlap(r, block.bounds) > 0)
      )
        continue;
      const translation = translations.find(
        (t) => t.blockId === block.id && t.status === "complete",
      );
      if (!translation) continue;
      const node = this.pageNode(block.page);
      let prefix = "",
        reliable = !!node;
      const indexes: number[] = [];
      for (const [i, sentence] of translation.sentences.entries()) {
        const boxes = node
          ? this.domSentenceBoxes(
              node,
              block,
              [sentence.source],
              prefix.replace(/[\s\u00ad]/g, "").length,
            )
          : [];
        prefix += sentence.source;
        if (!boxes.length) {
          reliable = false;
          break;
        }
        if (boxes.some((b) => selection.some((r) => overlap(b, r) > 0)))
          indexes.push(i);
      }
      result.push({
        blockId: block.id,
        sentenceIndexes:
          reliable && indexes.length
            ? indexes
            : translation.sentences.map((_, i) => i),
      });
    }
    return result;
  }
  private domSentenceBoxes(
    node: HTMLElement,
    block: PDFBlock,
    sources: string[],
    startOffset = 0,
  ): Box[] {
    const page = node.getBoundingClientRect();
    return this.domSentenceRanges(node, block, sources, startOffset).flatMap(
      (range) =>
        Array.from(range.getClientRects())
          .filter((r) => r.width && r.height)
          .map((r) => ({
            x: (r.left - page.left) / page.width,
            y: (r.top - page.top) / page.height,
            width: r.width / page.width,
            height: r.height / page.height,
          })),
    );
  }
  private domSentenceRanges(
    node: HTMLElement,
    block: PDFBlock,
    sources: string[],
    startOffset = 0,
  ): Range[] {
    const page = node.getBoundingClientRect();
    if (!page.width) return [];
    const nodes: Array<{ node: Text; offset: number; group: number }> = [],
      chars: string[] = [];
    const walker = document.createTreeWalker(
      node.querySelector(".textLayer") ?? document.createElement("div"),
      NodeFilter.SHOW_TEXT,
    );
    let text: Node | null,
      group = 0;
    while ((text = walker.nextNode())) {
      const parent = text.parentElement,
        r = parent?.getBoundingClientRect();
      if (!r) {
        group++;
        continue;
      }
      const b = {
        x: (r.left - page.left) / page.width,
        y: (r.top - page.top) / page.height,
        width: r.width / page.width,
        height: r.height / page.height,
      };
      // Parser bounds can cut through a PDF.js line. Include one line of
      // vertical context; sentence text, not this box, determines the highlight.
      const region = {
        ...block.bounds,
        y: block.bounds.y - b.height,
        height: block.bounds.height + 2 * b.height,
      };
      if (overlap(b, region) / (b.width * b.height || 1) < 0.5) {
        group++;
        continue;
      }
      for (let i = 0; i < (text.textContent?.length ?? 0); i++) {
        const c = text.textContent![i];
        if (/[\s\u00ad]/.test(c)) continue;
        chars.push(c.toLowerCase());
        nodes.push({ node: text as Text, offset: i, group });
      }
    }
    const joined = chars.join(""),
      ranges: Range[] = [];
    const normalize = (value: string) =>
      value.toLowerCase().replace(/[\s\u00ad]/g, "");
    for (const { start: i, end: cursor } of sentenceTextRanges(
      joined,
      normalize(block.text),
      sources.map(normalize),
      startOffset,
    )) {
      // PDF DOM order can interleave columns. Never let a Range bridge text
      // nodes that were excluded from this paragraph during matching.
      for (let start = i; start < cursor;) {
        let end = start + 1;
        while (end < cursor && nodes[end].group === nodes[start].group) end++;
        const a = nodes[start],
          z = nodes[end - 1];
        const range = document.createRange();
        range.setStart(a.node, a.offset);
        range.setEnd(z.node, z.offset + 1);
        ranges.push(range);
        start = end;
      }
    }
    return ranges;
  }
  repaint() {
    this.paintFocus();
  }
  destroy() {
    this.stop();
    this.disposed = true;
    this.clearLinkedRanges();
    cancelAnimationFrame(this.frame);
    this.host.removeEventListener("pointerdown", this.interrupt);
    this.host.removeEventListener("scroll", this.scrolled);
    this.host.removeEventListener("wheel", this.wheel);
    this.cache.clear();
  }
}

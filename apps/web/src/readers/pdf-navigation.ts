import * as pdfjs from "pdfjs-dist";
import type { PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
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
  overlap,
  readingColumns,
  sentenceBoxes,
  type Box,
  type TextRun,
} from "./pdf-reading";

export class PDFReadingNavigation {
  private cache = new Map<number, Promise<TextRun[]>>();
  private column?: { page: number; index: number; bounds: Box };
  private active = false;
  private moving = false;
  private disposed = false;
  private frame = 0;
  private operation = 0;
  private lastLeft = 0;
  private gesture = new ColumnGesture();
  private focus: PDFPassage[] = [];
  constructor(
    private host: HTMLElement,
    private viewer: PDFViewer,
    private page: (n: number) => Promise<pdfjs.PDFPageProxy>,
    private count: () => number,
    private blocks: () => PDFBlock[],
    private events: ReaderEvents,
  ) {
    host.addEventListener("scroll", this.scrolled, { passive: true });
    host.addEventListener("wheel", this.wheel, { passive: false });
  }
  get fitted() {
    return this.active;
  }
  relocated() {
    this.operation++;
    this.moving = false;
    this.lastLeft = this.host.scrollLeft;
    this.column = undefined;
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
                    (tr[5] - h * (text.styles[item.fontName]?.ascent ?? 0.8)) /
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
  private pageNode(n: number) {
    return this.viewer.getPageView(n - 1)?.div as HTMLElement | undefined;
  }
  private scrolled = () => {
    if (!this.moving && Math.abs(this.host.scrollLeft - this.lastLeft) > 3)
      this.stop();
    this.lastLeft = this.host.scrollLeft;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      if (this.disposed || this.moving) return;
      const anchor = this.anchor();
      if (anchor) this.events.readingAnchor?.(anchor);
    });
  };
  anchor(): PDFReadingAnchor | undefined {
    const viewport = this.host.getBoundingClientRect(),
      y = viewport.top + viewport.height * 0.3,
      x = viewport.left + viewport.width / 2;
    let best: PDFBlock | undefined,
      distance = Infinity,
      fraction = 0;
    for (const b of this.blocks()) {
      const node = this.pageNode(b.page);
      if (!node) continue;
      const r = node.getBoundingClientRect();
      if (r.bottom < viewport.top || r.top > viewport.bottom) continue;
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
    if (!this.active) return;
    this.active = false;
    this.events.columnFit?.(false);
  }
  async fit() {
    const operation = ++this.operation;
    const anchor = this.anchor(),
      block = this.blocks().find((b) => b.id === anchor?.blockId);
    const page = block?.page ?? this.viewer.currentPageNumber;
    const columns = readingColumns(await this.runs(page));
    if (this.disposed || operation !== this.operation) return;
    const node = this.pageNode(page),
      view = this.host.getBoundingClientRect(),
      r = node?.getBoundingClientRect();
    const point = block?.bounds ?? {
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
    await this.place(
      page,
      index,
      columns[index],
      false,
      block
        ? block.bounds.y + (anchor?.fraction ?? 0) * block.bounds.height
        : undefined,
    );
  }
  private async place(
    page: number,
    index: number,
    bounds: Box,
    bottom = false,
    targetY?: number,
  ) {
    const operation = ++this.operation;
    this.moving = true;
    this.active = true;
    this.column = { page, index, bounds };
    try {
      const p = await this.page(page);
      if (this.disposed || operation !== this.operation) return;
      const vp = p.getViewport({ scale: 1 });
      const scale = Math.min(
        5,
        Math.max(
          0.25,
          (this.host.clientWidth - 32) / (vp.width * (bounds.width + 0.025)),
        ),
      );
      if (this.viewer.currentPageNumber !== page)
        this.viewer.currentPageNumber = page;
      if (Math.abs(this.viewer.currentScale - scale) > 0.002)
        this.viewer.currentScaleValue = String(scale);
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      );
      if (this.disposed || operation !== this.operation) return;
      const node = this.pageNode(page);
      if (!node) return;
      const r = node.getBoundingClientRect(),
        v = this.host.getBoundingClientRect();
      this.host.scrollLeft += r.left - v.left + bounds.x * r.width - 16;
      this.lastLeft = this.host.scrollLeft;
      this.host.scrollTop +=
        r.top -
        v.top +
        (targetY ?? (bottom ? bounds.y + bounds.height : bounds.y)) * r.height -
        (targetY !== undefined
          ? this.host.clientHeight * 0.3
          : bottom
            ? this.host.clientHeight - 24
            : 24);
      this.events.columnFit?.(true);
    } finally {
      if (operation === this.operation) {
        this.moving = false;
        this.scrolled();
      }
    }
  }
  private wheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) return;
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey) {
      this.stop();
      return;
    }
    if (!this.active || !this.column) return;
    const fresh = this.gesture.accept(performance.now());
    if (this.moving) {
      event.preventDefault();
      return;
    }
    const node = this.pageNode(this.column.page);
    if (!node) return;
    const r = node.getBoundingClientRect(),
      v = this.host.getBoundingClientRect(),
      b = this.column.bounds;
    const bottom = r.top + (b.y + b.height) * r.height,
      top = r.top + b.y * r.height;
    const down = event.deltaY > 0;
    if ((down && bottom <= v.bottom + 26) || (!down && top >= v.top + 22)) {
      event.preventDefault();
      if (!fresh || event.deltaY === 0) return;
      this.gesture.transition();
      void this.step(down ? 1 : -1).catch(() => this.stop());
    }
  };
  private async step(direction: number) {
    if (!this.column) return;
    const operation = ++this.operation;
    let { page, index } = this.column;
    index += direction;
    let columns = readingColumns(await this.runs(page));
    if (this.disposed || operation !== this.operation) return;
    if (index < 0 || index >= columns.length) {
      page += direction;
      if (page < 1 || page > this.count()) return;
      columns = readingColumns(await this.runs(page));
      index = direction > 0 ? 0 : columns.length - 1;
    }
    if (!this.disposed && operation === this.operation)
      await this.place(page, index, columns[index], direction < 0);
  }
  async follow(anchor: PDFReadingAnchor) {
    const operation = ++this.operation;
    const block = this.blocks().find((b) => b.id === anchor.blockId);
    if (!block) return;
    if (this.active) {
      const columns = readingColumns(await this.runs(block.page));
      const index =
        columns
          .map((bounds, i) => ({ i, area: overlap(bounds, block.bounds) }))
          .sort((a, b) => b.area - a.area)[0]?.i ?? 0;
      if (this.disposed || operation !== this.operation) return;
      await this.place(
        block.page,
        index,
        columns[index],
        false,
        block.bounds.y + anchor.fraction * block.bounds.height,
      );
    } else {
      if (this.viewer.currentPageNumber !== block.page)
        this.viewer.currentPageNumber = block.page;
      const node = this.pageNode(block.page);
      if (!node) return;
      const r = node.getBoundingClientRect(),
        v = this.host.getBoundingClientRect();
      this.host.scrollTop +=
        r.top -
        v.top +
        (block.bounds.y + anchor.fraction * block.bounds.height) * r.height -
        this.host.clientHeight * 0.3;
      // Respect manual scale; only pan when the requested paragraph is offscreen.
      const x = r.left + block.bounds.x * r.width;
      if (x > v.right || x + block.bounds.width * r.width < v.left)
        this.host.scrollLeft += x - v.left - 16;
      this.lastLeft = this.host.scrollLeft;
    }
  }
  focusSentences(blockId: string, sources: string[], scroll = false) {
    return this.focusPassages(
      sources.length ? [{ blockId, sources }] : [],
      scroll,
    );
  }
  async focusPassages(passages: PDFPassage[], scroll = false) {
    this.focus = passages;
    this.host
      .querySelectorAll(".reader-linked-highlight")
      .forEach((n) => n.remove());
    for (const [index, passage] of passages.entries()) {
      const block = this.blocks().find((b) => b.id === passage.blockId);
      if (!block || !passage.sources.length) continue;
      const runs = await this.runs(block.page);
      if (this.disposed || this.focus !== passages) return;
      const approximate = sentenceBoxes(
        block,
        passage.sources,
        runs,
        passage.sourceOffset,
      );
      if (scroll && index === 0)
        await this.follow({
          blockId: block.id,
          fraction: Math.max(
            0,
            Math.min(
              1,
              (approximate[0].y - block.bounds.y) / block.bounds.height,
            ),
          ),
        });
      if (this.disposed || this.focus !== passages) return;
      const node = this.pageNode(block.page);
      if (!node) continue;
      const exact = this.domSentenceBoxes(
        node,
        block,
        passage.sources,
        passage.sourceOffset,
      );
      for (const b of exact.length ? exact : approximate) {
        const el = document.createElement("div");
        el.className = "reader-linked-highlight";
        Object.assign(el.style, {
          left: `${b.x * 100}%`,
          top: `${b.y * 100}%`,
          width: `${b.width * 100}%`,
          height: `${b.height * 100}%`,
        });
        node.append(el);
      }
    }
  }
  async matchSentences(
    location: PDFLocation,
    translations: TranslationBlock[],
  ): Promise<PDFSentenceLink[]> {
    const selection = location.rects ?? [],
      result: PDFSentenceLink[] = [];
    for (const block of this.blocks()) {
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
    if (!page.width) return [];
    const nodes: Array<{ node: Text; offset: number }> = [],
      chars: string[] = [];
    const walker = document.createTreeWalker(
      node.querySelector(".textLayer") ?? document.createElement("div"),
      NodeFilter.SHOW_TEXT,
    );
    let text: Node | null;
    while ((text = walker.nextNode())) {
      const parent = text.parentElement,
        r = parent?.getBoundingClientRect();
      if (!r) continue;
      const b = {
        x: (r.left - page.left) / page.width,
        y: (r.top - page.top) / page.height,
        width: r.width / page.width,
        height: r.height / page.height,
      };
      if (overlap(b, block.bounds) / (b.width * b.height || 1) < 0.5) continue;
      for (let i = 0; i < (text.textContent?.length ?? 0); i++) {
        const c = text.textContent![i];
        if (/[\s\u00ad]/.test(c)) continue;
        chars.push(c.toLowerCase());
        nodes.push({ node: text as Text, offset: i });
      }
    }
    const joined = chars.join(""),
      boxes: Box[] = [];
    let cursor = startOffset;
    for (const source of sources) {
      const needle = source.toLowerCase().replace(/[\s\u00ad]/g, "");
      const i = joined.indexOf(needle, cursor);
      if (i < 0 || !needle) return [];
      cursor = i + needle.length;
      const a = nodes[i],
        z = nodes[cursor - 1];
      const range = document.createRange();
      range.setStart(a.node, a.offset);
      range.setEnd(z.node, z.offset + 1);
      for (const r of Array.from(range.getClientRects()))
        if (r.width && r.height)
          boxes.push({
            x: (r.left - page.left) / page.width,
            y: (r.top - page.top) / page.height,
            width: r.width / page.width,
            height: r.height / page.height,
          });
    }
    return boxes;
  }
  repaint() {
    if (this.focus.length) void this.focusPassages(this.focus).catch(() => {});
  }
  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.host.removeEventListener("scroll", this.scrolled);
    this.host.removeEventListener("wheel", this.wheel);
    this.cache.clear();
  }
}

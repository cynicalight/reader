import { PDFBlockOverlay } from "./pdf-blocks";
import * as pdfjs from "pdfjs-dist";
import {
  EventBus,
  PDFLinkService,
  PDFViewer,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import workerURL from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import type {
  Annotation,
  PDFBlock,
  Document,
  DocumentLocation,
  PDFLocation,
  ReaderAdapter,
  ReaderEvents,
  ReaderSelection,
  ReaderTheme,
  SearchResult,
  TOCItem,
} from "@reader/core";
import { publicationURL } from "@reader/api";
pdfjs.GlobalWorkerOptions.workerSrc = workerURL;
export class PDFReaderAdapter implements ReaderAdapter {
  private pdf?: pdfjs.PDFDocumentProxy;
  private task?: pdfjs.PDFDocumentLoadingTask;
  private viewer: PDFViewer;
  private bus = new EventBus();
  private links: PDFLinkService;
  private location: PDFLocation = { type: "pdf", page: 1 };
  private selection: ReaderSelection | null = null;
  private annotations: Annotation[] = [];
  private texts = new Map<number, string>();
  private resize: ResizeObserver;
  private fitWidth = true;
  private disposed = false;
  private blocks: PDFBlockOverlay;
  constructor(
    private container: HTMLElement,
    private events: ReaderEvents,
  ) {
    container.classList.add("pdf-container");
    this.blocks = new PDFBlockOverlay(container);
    const viewer = document.createElement("div");
    viewer.className = "pdfViewer";
    container.append(viewer);
    this.links = new PDFLinkService({
      eventBus: this.bus,
      externalLinkTarget: 2,
    });
    this.viewer = new PDFViewer({
      container: container as HTMLDivElement,
      viewer,
      eventBus: this.bus,
      linkService: this.links,
      textLayerMode: 1,
      annotationMode: pdfjs.AnnotationMode.ENABLE,
      removePageBorders: true,
    });
    this.links.setViewer(this.viewer);
    this.bus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => {
      this.location = { type: "pdf", page: pageNumber };
      this.events.location(
        this.location,
        pageNumber / (this.pdf?.numPages || 1),
      );
    });
    this.bus.on("pagerendered", () => this.paintHighlights());
    container.addEventListener("mouseup", this.onSelection);
    this.resize = new ResizeObserver(() => {
      if (this.pdf && this.fitWidth)
        this.viewer.currentScaleValue = "page-width";
    });
    this.resize.observe(container);
  }
  async open(doc: Document) {
    this.task = pdfjs.getDocument({
      url: publicationURL(doc.id, "original.pdf"),
      cMapUrl: "/pdf-assets/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdf-assets/standard_fonts/",
      wasmUrl: "/pdf-assets/wasm/",
    });
    this.pdf = await this.task.promise;
    if (this.disposed) return;
    const initialized = new Promise<void>((resolve) => {
      const ready = () => {
        this.bus.off("pagesinit", ready);
        resolve();
      };
      this.bus.on("pagesinit", ready);
    });
    this.viewer.setDocument(this.pdf);
    this.links.setDocument(this.pdf);
    await initialized;
    if (this.disposed) return;
    this.viewer.currentScaleValue = "page-width";
    if (doc.progress?.type === "pdf") await this.goTo(doc.progress);
    else this.events.location(this.location, 1 / this.pdf.numPages);
  }
  async getTOC(): Promise<TOCItem[]> {
    if (!this.pdf) return [];
    const outline = await this.pdf.getOutline();
    const map = async (
      items: NonNullable<typeof outline>,
      prefix = "",
    ): Promise<TOCItem[]> =>
      Promise.all(
        items.map(async (item, i) => {
          let page = 1;
          let dest = item.dest;
          try {
            if (typeof dest === "string")
              dest = await this.pdf!.getDestination(dest);
            if (Array.isArray(dest)) {
              page =
                typeof dest[0] === "number"
                  ? dest[0] + 1
                  : (await this.pdf!.getPageIndex(dest[0])) + 1;
            }
          } catch {
            /* broken outline entry keeps a safe page */
          }
          return {
            id: `${prefix}${i}`,
            label: item.title,
            location: { type: "pdf" as const, page },
            children: await map(item.items, `${prefix}${i}-`),
          };
        }),
      );
    return outline?.length
      ? map(outline)
      : Array.from({ length: this.pdf.numPages }, (_, i) => ({
          id: `page-${i + 1}`,
          label: `第 ${i + 1} 页`,
          location: { type: "pdf", page: i + 1 },
          children: [],
        }));
  }
  getLocation() {
    return this.location;
  }
  async goTo(location: DocumentLocation) {
    if (location.type !== "pdf" || !this.pdf) return;
    const page = Math.max(1, Math.min(this.pdf.numPages, location.page));
    this.viewer.currentPageNumber = page;
    this.viewer.scrollPageIntoView({ pageNumber: page });
    this.location = { ...location, page };
  }
  async next() {
    await this.goTo({ type: "pdf", page: this.location.page + 1 });
  }
  async previous() {
    await this.goTo({ type: "pdf", page: this.location.page - 1 });
  }
  private async pageText(page: number) {
    if (!this.texts.has(page) && this.pdf) {
      const p = await this.pdf.getPage(page);
      const content = await p.getTextContent();
      this.texts.set(
        page,
        content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
      );
    }
    return this.texts.get(page) || "";
  }
  async search(query: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    if (!query.trim() || !this.pdf) return results;
    for (let page = 1; page <= this.pdf.numPages && !this.disposed; page++) {
      const text = await this.pageText(page);
      const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
      if (index >= 0)
        results.push({
          id: `${page}`,
          excerpt: text.slice(
            Math.max(0, index - 65),
            index + query.length + 110,
          ),
          location: { type: "pdf", page, quote: query },
        });
      if (results.length >= 100) break;
    }
    return results;
  }
  private onSelection = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!sel?.rangeCount || !text) return;
    const range = sel.getRangeAt(0);
    const start =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
    const end =
      range.endContainer instanceof Element
        ? range.endContainer
        : range.endContainer.parentElement;
    const page = start?.closest<HTMLElement>(".page");
    if (
      !page ||
      !this.container.contains(page) ||
      end?.closest(".page") !== page
    )
      return;
    const bounds = page.getBoundingClientRect();
    const rects = Array.from(range.getClientRects())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({
        x: (r.x - bounds.x) / bounds.width,
        y: (r.y - bounds.y) / bounds.height,
        width: r.width / bounds.width,
        height: r.height / bounds.height,
      }));
    this.selection = {
      text,
      location: {
        type: "pdf",
        page: Number(page.dataset.pageNumber),
        quote: text,
        rects,
      },
    };
    this.events.selection(this.selection);
  };
  getSelection() {
    return this.selection;
  }
  async highlight(annotations: Annotation[]) {
    this.annotations = annotations;
    this.paintHighlights();
  }
  private paintHighlights() {
    this.container
      .querySelectorAll(".reader-highlight")
      .forEach((el) => el.remove());
    for (const a of this.annotations) {
      if (a.location.type !== "pdf" || a.kind === "bookmark") continue;
      const page = this.container.querySelector<HTMLElement>(
        `.page[data-page-number="${a.location.page}"]`,
      );
      if (!page) continue;
      for (const r of a.location.rects || []) {
        const el = document.createElement("div");
        el.className = "reader-highlight";
        Object.assign(el.style, {
          left: `${r.x * 100}%`,
          top: `${r.y * 100}%`,
          width: `${r.width * 100}%`,
          height: `${r.height * 100}%`,
          background:
            a.kind === "underline" ? "transparent" : a.color || "#facc15",
          borderBottom:
            a.kind === "underline"
              ? `2px solid ${a.color || "#eab308"}`
              : "none",
        });
        page.append(el);
      }
    }
  }
  async setTheme(theme: ReaderTheme) {
    this.fitWidth = theme.zoom === "width";
    if (this.pdf)
      this.viewer.currentScaleValue = this.fitWidth
        ? "page-width"
        : String(theme.zoom);
    this.container.dataset.theme = theme.mode;
  }
  async getContext() {
    return this.pageText(this.location.page);
  }
  setBlocks(blocks: PDFBlock[]) {
    this.blocks.setBlocks(blocks);
  }
  async destroy() {
    this.blocks.destroy();
    this.disposed = true;
    this.resize.disconnect();
    this.container.removeEventListener("mouseup", this.onSelection);
    this.viewer.setDocument(null as unknown as pdfjs.PDFDocumentProxy);
    await this.task?.destroy();
    this.container.replaceChildren();
  }
}

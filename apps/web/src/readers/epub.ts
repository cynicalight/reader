import { selectionAnchor, isSelectionToolbar } from "./selection-anchor";
import { selectionLocator } from "./selection-locator";
import { installScrollbars } from "../scrollbars";
import {
  EpubNavigator,
  EpubPreferences,
  DecorationLayout,
  DecorationWidth,
  type Decoration,
  type DecorationObserver,
  type EpubNavigatorListeners,
} from "@readium/navigator";
import {
  HttpFetcher,
  Locator,
  Manifest,
  Publication,
  type Link,
} from "@readium/shared";
import { api, publicationURL } from "@reader/api";
import type {
  Annotation,
  Document,
  DocumentLocation,
  EPUBLocation,
  ReaderAdapter,
  ReaderEvents,
  ReaderSelection,
  ReaderTheme,
  SelectionAnchor,
  SearchResult,
  TOCItem,
} from "@reader/core";
import { selectSentence, sentenceRoot } from "./sentence-selection";
export class EPUBReaderAdapter implements ReaderAdapter {
  private navigator?: EpubNavigator;
  private publication?: Publication;
  private location: EPUBLocation = { type: "epub", href: "" };
  private selection: ReaderSelection | null = null;
  private doc?: Document;
  private disposed = false;
  private frameCleanups = new Map<Window, () => void>();
  private pointers = new WeakMap<Window, { x: number; y: number }>();
  private selectedWindow?: Window;
  private annotations: Annotation[] = [];
  private annotationAnchor?: SelectionAnchor;
  private hoverAllowed = false;
  private hoveredAnnotation?: string;
  private clearAnnotationHover = () => {
    if (!this.hoveredAnnotation) return;
    this.hoveredAnnotation = undefined;
    this.navigator?.applyDecorations([], "annotation-hover");
  };
  private annotationObserver: DecorationObserver = {
    onDecorationActivated: ({ decoration }) => {
      if (
        this.disposed ||
        !this.annotationAnchor ||
        this.hasTextSelection() ||
        !this.annotations.some((a) => a.id === decoration.id)
      )
        return false;
      this.events.annotation?.({
        ids: [decoration.id],
        anchor: this.annotationAnchor,
      });
      this.annotationAnchor = undefined;
      return true;
    },
    onDecorationPointerEnter: ({ decoration }) => {
      if (
        this.disposed ||
        !this.hoverAllowed ||
        this.hasTextSelection() ||
        !this.annotations.some((a) => a.id === decoration.id)
      )
        return;
      this.hoveredAnnotation = decoration.id;
      this.navigator?.applyDecorations(
        [
          {
            id: decoration.id,
            locator: decoration.locator,
            style: {
              type: "template",
              layout: DecorationLayout.Boxes,
              width: DecorationWidth.Wrap,
              element: () =>
                '<div style="background:rgba(230,185,76,0.18);border-radius:2px;"></div>',
            },
          },
        ],
        "annotation-hover",
      );
    },
    onDecorationPointerLeave: ({ decoration }) => {
      if (this.hoveredAnnotation === decoration.id) this.clearAnnotationHover();
    },
  };
  private hasTextSelection() {
    return Array.from(this.container.querySelectorAll("iframe")).some((frame) =>
      frame.contentWindow?.getSelection()?.toString().trim(),
    );
  }
  private resize: ResizeObserver;
  constructor(
    private container: HTMLElement,
    private events: ReaderEvents,
  ) {
    document.addEventListener("pointerdown", this.onOutsidePointer);
    document.addEventListener("keydown", this.onKeyDown);
    this.resize = new ResizeObserver(this.clearSelection);
    this.resize.observe(container);
  }
  private clearState = () => {
    this.selectedWindow = undefined;
    if (!this.selection) return;
    this.selection = null;
    this.events.selection(null);
  };
  clearSelection = () => {
    this.annotationAnchor = undefined;
    this.hoverAllowed = false;
    this.clearAnnotationHover();
    this.events.annotation?.(null);
    for (const frame of this.container.querySelectorAll("iframe"))
      frame.contentWindow?.getSelection()?.removeAllRanges();
    this.clearState();
  };
  private onOutsidePointer = (event: PointerEvent) => {
    if (!isSelectionToolbar(event.target)) this.clearSelection();
  };
  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") this.clearSelection();
  };
  private bindFrame = (wnd: Window) => {
    this.frameCleanups.get(wnd)?.();
    const doc = wnd.document;
    let pressed: { x: number; y: number } | undefined;
    const annotationPress = (event: PointerEvent) => {
      this.annotationAnchor = undefined;
      this.hoverAllowed = false;
      this.clearAnnotationHover();
      this.events.annotation?.(null);
      pressed =
        event.button === 0 &&
        !(event.target as Element | null)?.closest?.(
          "a, button, input, textarea, select",
        )
          ? { x: event.clientX, y: event.clientY }
          : undefined;
    };
    const annotationRelease = (event: PointerEvent) => {
      this.annotationAnchor = undefined;
      if (
        pressed &&
        event.button === 0 &&
        Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) <= 5 &&
        !this.hasTextSelection()
      ) {
        const frame = Array.from(
          this.container.querySelectorAll("iframe"),
        ).find((f) => f.contentWindow === wnd);
        if (frame) {
          const bounds = frame.getBoundingClientRect();
          const sx = frame.offsetWidth ? bounds.width / frame.offsetWidth : 1;
          const sy = frame.offsetHeight
            ? bounds.height / frame.offsetHeight
            : 1;
          this.annotationAnchor = {
            x: bounds.left + (frame.clientLeft + event.clientX) * sx,
            top: bounds.top + (frame.clientTop + event.clientY - 8) * sy,
            bottom: bounds.top + (frame.clientTop + event.clientY + 8) * sy,
          };
        }
      }
      pressed = undefined;
    };
    const annotationMove = (event: PointerEvent) => {
      this.hoverAllowed = !event.buttons && !this.hasTextSelection();
      if (!this.hoverAllowed) this.clearAnnotationHover();
    };
    const annotationLeave = () => {
      this.hoverAllowed = false;
      this.clearAnnotationHover();
    };
    const removeScrollbars = installScrollbars(doc);
    const changed = () => {
      const selected = wnd.getSelection();
      if (
        this.selectedWindow === wnd &&
        (!selected?.rangeCount ||
          selected.isCollapsed ||
          !selected.toString().trim())
      )
        this.clearState();
    };
    const start = () => {
      this.pointers.delete(wnd);
      this.clearState();
    };
    const released = (event: MouseEvent) => {
      // A double click selects the whole sentence instead of one word.
      if (event.detail === 2) {
        const selection = doc.getSelection();
        const root = sentenceRoot(selection?.anchorNode ?? null);
        if (root) selectSentence(selection, root);
      }
      this.pointers.set(wnd, { x: event.clientX, y: event.clientY });
      changed();
    };
    const key = (event: KeyboardEvent) => {
      this.pointers.delete(wnd);
      this.onKeyDown(event);
    };
    const unload = () => {
      this.clearSelection();
      if (this.selectedWindow === wnd) this.clearState();
      cleanup();
      this.frameCleanups.delete(wnd);
    };
    const cleanup = () => {
      removeScrollbars();
      doc.removeEventListener("pointerdown", annotationPress, true);
      doc.removeEventListener("pointerup", annotationRelease, true);
      doc.removeEventListener("pointermove", annotationMove, true);
      doc.removeEventListener("pointerleave", annotationLeave);
      doc.removeEventListener("selectionchange", changed);
      doc.removeEventListener("pointerdown", start);
      doc.removeEventListener("mouseup", released);
      doc.removeEventListener("keydown", key);
      doc.removeEventListener("scroll", this.clearSelection, true);
      wnd.removeEventListener("pagehide", unload);
    };
    doc.addEventListener("selectionchange", changed);
    doc.addEventListener("pointerdown", annotationPress, true);
    doc.addEventListener("pointerup", annotationRelease, true);
    doc.addEventListener("pointermove", annotationMove, true);
    doc.addEventListener("pointerleave", annotationLeave);
    doc.addEventListener("pointerdown", start);
    doc.addEventListener("mouseup", released);
    doc.addEventListener("keydown", key);
    doc.addEventListener("scroll", this.clearSelection, true);
    wnd.addEventListener("pagehide", unload);
    this.frameCleanups.set(wnd, cleanup);
  };
  private fromLocator(locator: Locator): EPUBLocation {
    return {
      type: "epub",
      href: locator.href,
      locator: JSON.stringify(locator.serialize()),
      progression: locator.locations.progression,
      quote: locator.text?.highlight,
    };
  }
  private toLocator(location: EPUBLocation): Locator {
    if (location.locator) {
      try {
        const locator = Locator.deserialize(JSON.parse(location.locator));
        if (locator) return locator;
      } catch {
        /* recover from href */
      }
    }
    return Locator.deserialize({
      href: location.href.split("#")[0],
      type: "application/xhtml+xml",
      locations: {
        progression: location.progression,
        fragments: location.href.includes("#")
          ? [location.href.split("#")[1]]
          : [],
      },
      text: { highlight: location.quote },
    })!;
  }
  async open(doc: Document) {
    this.doc = doc;
    const url = new URL(
      publicationURL(doc.id, "manifest.json"),
      window.location.origin,
    ).href;
    const response = await fetch(url);
    if (!response.ok) throw new Error("无法加载 EPUB 目录");
    const json = await response.json();
    json.links = [
      { rel: "self", href: url, type: "application/webpub+json" },
      {
        rel: "http://readium.org/positions",
        href: "positions.json",
        type: "application/vnd.readium.position-list+json",
      },
    ];
    const manifest = Manifest.deserialize(json);
    if (!manifest) throw new Error("EPUB manifest 无效");
    this.publication = new Publication({
      manifest,
      fetcher: new HttpFetcher(undefined, url),
    });
    const positions = await this.publication.positionsFromManifest();
    if (this.disposed) return;
    const listeners: EpubNavigatorListeners = {
      frameLoaded: this.bindFrame,
      positionChanged: (locator) => {
        this.clearSelection();
        this.location = this.fromLocator(locator);
        const index = this.publication!.readingOrder.items.findIndex(
          (l) => l.href === locator.href,
        );
        const percent =
          locator.locations.totalProgression ??
          (Math.max(0, index) + (locator.locations.progression || 0)) /
            Math.max(1, this.publication!.readingOrder.items.length);
        this.events.location(this.location, percent);
      },
      timelineItemChanged: () => {},
      tap: () => false,
      click: () => false,
      zoom: () => {},
      miscPointer: () => {},
      scroll: this.clearSelection,
      customEvent: () => {},
      handleLocator: (locator) => /^[a-z]+:/i.test(locator.href),
      textSelected: (selection) => {
        if (!selection.text.trim()) return this.clearState();
        const frame = Array.from(
          this.container.querySelectorAll("iframe"),
        ).find((frame) => frame.src === selection.targetFrameSrc);
        const selected = frame?.contentWindow?.getSelection();
        if (
          !selected ||
          selected.isCollapsed ||
          selected.toString().trim().replace(/\s+/g, " ") !==
            selection.text.trim().replace(/\s+/g, " ")
        )
          return this.clearState();
        const exact =
          selection.locator && selected?.rangeCount
            ? selectionLocator(selection.locator, selected.getRangeAt(0))
            : undefined;
        // A quote alone cannot identify repeated passages. Only expose selections
        // once their exact DOM range has been captured in the Readium locator.
        if (!exact) return this.clearState();
        const location = this.fromLocator(exact);
        this.selectedWindow = frame?.contentWindow ?? undefined;
        this.selection = {
          text: selection.text,
          location,
          anchor: selectionAnchor(
            selected,
            this.selectedWindow
              ? this.pointers.get(this.selectedWindow)
              : undefined,
            frame,
          ),
        };
        this.events.selection(this.selection);
      },
      contentProtection: () => {},
      contextMenu: () => {},
      peripheral: () => {},
    };
    this.navigator = new EpubNavigator(
      this.container,
      this.publication,
      listeners,
      positions,
      doc.progress?.type === "epub" ? this.toLocator(doc.progress) : undefined,
      {
        preferences: { fontSize: 1.15, lineHeight: 1.8, columnCount: 1 },
        defaults: {},
      },
    );
    this.navigator.registerDecorationObserver(
      "annotations",
      this.annotationObserver,
    );
    await this.navigator.load();
  }
  async getTOC(): Promise<TOCItem[]> {
    const map = (items: Link[], prefix = ""): TOCItem[] =>
      items.map((link, i) => ({
        id: `${prefix}${i}`,
        label: link.title || `章节 ${i + 1}`,
        location: { type: "epub", href: link.href },
        children: map(link.children?.items || [], `${prefix}${i}-`),
      }));
    return map(
      this.publication?.toc?.items.length
        ? this.publication.toc.items
        : this.publication?.readingOrder.items || [],
    );
  }
  getLocation() {
    return this.location;
  }
  async goTo(location: DocumentLocation) {
    if (location.type !== "epub" || !this.navigator) return;
    this.clearSelection();
    await new Promise<void>((resolve, reject) =>
      this.navigator!.go(this.toLocator(location), false, (ok) =>
        ok ? resolve() : reject(new Error("无法跳转到该位置")),
      ),
    );
  }
  async next() {
    this.clearSelection();
    await new Promise<void>((resolve) =>
      this.navigator?.goForward(false, () => resolve()),
    );
  }
  async previous() {
    this.clearSelection();
    await new Promise<void>((resolve) =>
      this.navigator?.goBackward(false, () => resolve()),
    );
  }
  async search(query: string): Promise<SearchResult[]> {
    return this.doc ? api.search(this.doc.id, query) : [];
  }
  getSelection() {
    return this.selection;
  }
  async highlight(annotations: Annotation[]) {
    this.annotations = annotations;
    this.clearAnnotationHover();
    const decorations: Decoration[] = annotations
      .filter(
        (a) => a.location.type === "epub" && a.kind !== "bookmark" && a.quote,
      )
      .map((a) => ({
        id: a.id,
        locator: this.toLocator(a.location as EPUBLocation),
        style: {
          type: a.kind === "underline" ? "underline" : "highlight",
          tint: a.color || "#facc15",
        },
      }));
    this.navigator?.applyDecorations(decorations, "annotations");
  }
  async setTheme(theme: ReaderTheme) {
    this.clearSelection();
    const palette = {
      light: ["#ffffff", "#27272a"],
      sepia: ["#f7f6f2", "#1f1e1d"],
      dark: ["#202020", "#dededb"],
    }[theme.mode];
    await this.navigator?.submitPreferences(
      new EpubPreferences({
        fontSize: theme.fontSize,
        fontFamily: theme.fontFamily,
        lineHeight: theme.lineHeight,
        pageGutter: theme.margin,
        scrollPaddingLeft: theme.margin,
        scrollPaddingRight: theme.margin,
        scroll: theme.scroll,
        backgroundColor: palette[0],
        textColor: palette[1],
        columnCount: 1,
      }),
    );
  }
  async getContext() {
    if (!this.doc || !this.location.href) return "";
    const response = await fetch(
      publicationURL(this.doc.id, this.location.href.split("#")[0]),
    );
    if (!response.ok) throw new Error("无法读取章节");
    const html = new DOMParser().parseFromString(
      await response.text(),
      "text/html",
    );
    html.querySelectorAll("style,script").forEach((el) => el.remove());
    return html.body.textContent?.trim().slice(0, 24000) || "";
  }
  async destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.resize.disconnect();
    document.removeEventListener("pointerdown", this.onOutsidePointer);
    document.removeEventListener("keydown", this.onKeyDown);
    for (const cleanup of this.frameCleanups.values()) cleanup();
    this.frameCleanups.clear();
    this.clearSelection();
    this.navigator?.unregisterDecorationObserver(this.annotationObserver);
    await this.navigator?.destroy();
    this.container.replaceChildren();
  }
}

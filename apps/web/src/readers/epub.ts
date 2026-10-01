import {
  EpubNavigator,
  EpubPreferences,
  type Decoration,
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
  SearchResult,
  TOCItem,
} from "@reader/core";
export class EPUBReaderAdapter implements ReaderAdapter {
  private navigator?: EpubNavigator;
  private publication?: Publication;
  private location: EPUBLocation = { type: "epub", href: "" };
  private selection: ReaderSelection | null = null;
  private doc?: Document;
  private disposed = false;
  constructor(
    private container: HTMLElement,
    private events: ReaderEvents,
  ) {}
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
      frameLoaded: () => {},
      positionChanged: (locator) => {
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
      scroll: () => {},
      customEvent: () => {},
      handleLocator: (locator) => /^[a-z]+:/i.test(locator.href),
      textSelected: (selection) => {
        if (!selection.text.trim()) return;
        const location = selection.locator
          ? this.fromLocator(selection.locator)
          : { ...this.location, quote: selection.text };
        this.selection = { text: selection.text, location };
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
    await new Promise<void>((resolve, reject) =>
      this.navigator!.go(this.toLocator(location), false, (ok) =>
        ok ? resolve() : reject(new Error("无法跳转到该位置")),
      ),
    );
  }
  async next() {
    await new Promise<void>((resolve) =>
      this.navigator?.goForward(false, () => resolve()),
    );
  }
  async previous() {
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
    const palette = {
      light: ["#ffffff", "#27272a"],
      sepia: ["#f5efdf", "#433b2f"],
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
    this.disposed = true;
    await this.navigator?.destroy();
    this.container.replaceChildren();
  }
}

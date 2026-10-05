import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  Annotation,
  Document as ReaderDocument,
  DocumentLocation,
  PDFBlock,
  PDFReadingAnchor,
  Processing,
  ReaderAdapter,
  ReaderEvents,
  ReaderSelection,
  ReaderTheme,
  TOCItem,
  TranslationBlock,
} from "@reader/core";
import { api } from "@reader/api";
import { ArrowLeftRight, Columns2, Link2, Unlink2 } from "lucide-react";
import { Button } from "@reader/ui/components/button";
import { Tabs, TabsList, TabsTrigger } from "@reader/ui/components/tabs";
import { Popover, PopoverContent } from "@reader/ui/components/popover";
import { toast } from "sonner";
import { ReaderView } from "../ReaderView";
import { overlap, ReadingSync } from "../readers/pdf-reading";
import { TranslationText } from "./TranslationText";
import { paintTranslatedAnnotations } from "./annotations";
import { translatedSelection as captureTranslationSelection } from "./selection";
import "./translation.css";

type Mode = "source" | "parallel" | "translation";
export function PDFReadingView({
  document: doc,
  theme,
  annotations,
  blocks,
  processing,
  toolbarHost,
  onReady,
  events,
}: {
  document: ReaderDocument;
  theme: ReaderTheme;
  annotations: Annotation[];
  blocks: PDFBlock[];
  processing?: Processing;
  toolbarHost?: HTMLElement | null;
  onReady: (adapter: ReaderAdapter, toc: TOCItem[]) => void;
  events: ReaderEvents;
}) {
  const [mode, setMode] = useState<Mode>("source"),
    [swapped, setSwapped] = useState(false),
    [sync, setSync] = useState(true),
    [fitted, setFitted] = useState(false);
  const [translations, setTranslations] = useState<TranslationBlock[]>([]),
    [error, setError] = useState("");
  const [popup, setPopup] = useState<{ block: PDFBlock; rect: DOMRect }>(),
    [linked, setLinked] = useState<Record<string, number[]>>();
  const [engine, setEngine] = useState<ReaderAdapter>();
  const [hoveredBlock, setHoveredBlock] = useState<string>();
  const hoverOwner = useRef<"source" | "translation" | undefined>(undefined);
  const hover = (origin: "source" | "translation", blockId?: string) => {
    if (!blockId && hoverOwner.current !== origin) return;
    hoverOwner.current = blockId ? origin : undefined;
    setHoveredBlock(blockId);
    engine?.hoverBlock?.(
      mode === "parallel" && origin === "translation"
        ? (blockId ?? null)
        : null,
    );
  };
  const previousMode = useRef<Mode>("source");
  const root = useRef<HTMLDivElement>(null),
    pane = useRef<HTMLDivElement>(null),
    control = useRef(new ReadingSync()),
    side = useRef<"source" | "translation">("source"),
    reading = useRef<PDFReadingAnchor | undefined>(undefined);
  const state = useRef({ mode, sync, blocks, translations, events });
  state.current = { mode, sync, blocks, translations, events };
  const byId = useMemo(
    () => new Map(translations.map((t) => [t.blockId, t])),
    [translations],
  );
  const selecting = useRef(false),
    selection = useRef<ReaderSelection | null>(null),
    scrollFrame = useRef(0);
  const visibleBlocks = blocks.filter(
    (b) => !["header", "footer", "number"].includes(b.label),
  );
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 500;
    const subscribe = async () => {
      try {
        await api.translationStream(doc.id, controller.signal, (event) => {
          if (controller.signal.aborted) return;
          retryDelay = 500;
          setError("");
          if (event.event === "snapshot") setTranslations(event.data);
          else
            setTranslations((current) => {
              const index = current.findIndex(
                (b) => b.blockId === event.data.blockId,
              );
              if (index < 0) return [...current, event.data];
              return current.map((b, i) => (i === index ? event.data : b));
            });
        });
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) {
          timer = setTimeout(() => void subscribe(), retryDelay);
          retryDelay = Math.min(retryDelay * 2, 5000);
        }
      }
    };
    void subscribe();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [doc.id]);
  const translate = async (blockId = "") => {
    try {
      await api.translate(doc.id, blockId);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const targetNode = (id: string) =>
    Array.from(
      pane.current?.querySelectorAll<HTMLElement>("[data-translation-block]") ??
        [],
    ).find((n) => n.dataset.translationBlock === id);
  const followTranslation = (
    anchor: PDFReadingAnchor,
    sentenceIndex?: number,
  ) => {
    const node = targetNode(anchor.blockId),
      host = pane.current;
    if (!node || !host) return;
    control.current.following("translation");
    const target =
      sentenceIndex === undefined
        ? node
        : (node.querySelector<HTMLElement>(
            `[data-sentence="${sentenceIndex}"]`,
          ) ?? node);
    const r = target.getBoundingClientRect(),
      v = host.getBoundingClientRect();
    host.scrollTop +=
      r.top -
      v.top +
      (sentenceIndex === undefined ? r.height * anchor.fraction : 0) -
      v.height * 0.3;
  };
  const go = async (location: DocumentLocation) => {
    input(mode === "translation" ? "translation" : "source");
    await engine?.goTo(location);
    if (location.type !== "pdf") return;
    const block =
      state.current.blocks.find(
        (b) => b.id === location.translation?.blockId,
      ) ?? state.current.blocks.find((b) => b.page === location.page);
    if (block) {
      const anchor = { blockId: block.id, fraction: 0 };
      reading.current = anchor;
      followTranslation(anchor, location.translation?.sentenceIndexes[0]);
      state.current.events.location(
        location,
        block.page / Math.max(1, ...state.current.blocks.map((b) => b.page)),
      );
    }
  };
  // Keep the public adapter usable by TOC, notes and page navigation in all modes.
  const facade = useRef<ReaderAdapter | undefined>(undefined);
  const actions = useRef({ go });
  actions.current = { go };
  const ready = (adapter: ReaderAdapter, toc: TOCItem[]) => {
    setEngine(adapter);
    facade.current = new Proxy(adapter, {
      get(target, key) {
        if (key === "goTo")
          return (l: DocumentLocation) => actions.current.go(l);
        if (key === "next" || key === "previous")
          return () => {
            if (!state.current.blocks.length) return target[key]();
            const block = state.current.blocks.find(
              (b) => b.id === reading.current?.blockId,
            );
            const current =
              block?.page ?? (target.getLocation() as { page: number }).page;
            return actions.current.go({
              type: "pdf",
              page: Math.max(1, current + (key === "next" ? 1 : -1)),
            });
          };
        if (key === "getLocation" && state.current.mode === "translation")
          return () => {
            const block = state.current.blocks.find(
              (b) => b.id === reading.current?.blockId,
            );
            return block
              ? {
                  type: "pdf",
                  page: block.page,
                  x: block.bounds.x,
                  y:
                    block.bounds.y +
                    (reading.current?.fraction ?? 0) * block.bounds.height,
                }
              : target.getLocation();
          };
        if (key === "clearSelection")
          return () => {
            window.getSelection()?.removeAllRanges();
            selection.current = null;
            setLinked(undefined);
            void target.focusSentences?.("", []);
            state.current.events.selection(null);
            target.clearSelection();
          };
        if (key === "getSelection")
          return () => selection.current ?? target.getSelection();
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    onReady(facade.current, toc);
  };
  useEffect(() => {
    if (!engine) return;
    hoverOwner.current = undefined;
    setHoveredBlock(undefined);
    engine.hoverBlock?.(null);
    const previous = previousMode.current;
    previousMode.current = mode;
    let cancelled = false;
    selection.current = null;
    events.selection(null);
    window.getSelection()?.removeAllRanges();
    setLinked(undefined);
    void engine.focusSentences?.("", []);
    const restore = async () => {
      if (
        previous === "translation" &&
        mode !== "translation" &&
        reading.current
      )
        await engine.followBlock?.(reading.current);
      if (cancelled) return;
      if (mode === "parallel") await engine.fitColumn?.();
      else engine.stopColumnFit?.();
      if (!cancelled && mode !== "source" && reading.current)
        followTranslation(reading.current);
    };
    void restore().catch((e) => {
      if (!cancelled) toast.error(e.message);
    });
    return () => {
      cancelled = true;
      engine.stopColumnFit?.();
      engine.hoverBlock?.(null);
    };
  }, [mode, engine]);
  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);
  useEffect(() => {
    const release = () => {
      selecting.current = false;
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);
  useEffect(() => {
    const host = pane.current;
    if (!host) return;
    let clean: (() => void) | undefined;
    const paint = () => {
      clean?.();
      clean = paintTranslatedAnnotations(host, annotations, translations);
    };
    paint();
    const observer = new MutationObserver(paint);
    observer.observe(host, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      clean?.();
    };
  }, [mode, annotations, translations]);
  const input = (active: typeof side.current) => {
    side.current = active;
    control.current.input(active);
  };
  const sourceSelection = (value: ReaderSelection | null) => {
    if (side.current !== "source") return;
    selection.current = value;
    events.selection(value);
    if (!value || value.location.type !== "pdf") {
      setLinked(undefined);
      return;
    }
    const location = value.location;
    const fallback = blocks
      .filter(
        (b) =>
          b.page === location.page &&
          location.rects?.some((r) => overlap(r, b.bounds) > 0),
      )
      .flatMap((block) => {
        const t = byId.get(block.id);
        if (!t) return [];
        const needle = value.text.replace(/\s/g, "").toLowerCase();
        const matches = t.sentences.flatMap((s, i) =>
          s.source.replace(/\s/g, "").toLowerCase().includes(needle) ? [i] : [],
        );
        return [
          {
            blockId: block.id,
            sentenceIndexes:
              matches.length === 1 ? matches : t.sentences.map((_, i) => i),
          },
        ];
      });
    const map = async () => {
      const links =
        (await engine?.matchSentences?.(location, translations)) ?? fallback;
      if (selection.current !== value || !links.length) return;
      setLinked(
        Object.fromEntries(links.map((l) => [l.blockId, l.sentenceIndexes])),
      );
      reading.current = { blockId: links[0].blockId, fraction: 0 };
      if (state.current.mode === "parallel")
        followTranslation(reading.current, links[0].sentenceIndexes[0]);
    };
    void map().catch((e) => toast.error(e.message));
  };
  const translatedSelection = () => {
    selecting.current = false;
    const selected = window.getSelection();
    if (!selected?.rangeCount || !selected.toString().trim() || !pane.current)
      return;
    const value = captureTranslationSelection(
      pane.current,
      selected.getRangeAt(0),
      blocks,
      translations,
    );
    if (!value) return;
    selection.current = value.selection;
    events.selection(value.selection);
    setLinked(
      Object.fromEntries(
        value.links.map((l) => [l.blockId, l.sentenceIndexes]),
      ),
    );
    reading.current = { blockId: value.links[0].blockId, fraction: 0 };
    if (mode === "parallel") {
      control.current.following("source");
      const first = value.passages[0];
      void (
        engine?.focusPassages
          ? engine.focusPassages(value.passages, true)
          : engine?.focusSentences?.(first.blockId, first.sources, true)
      )?.catch((e) => toast.error(e.message));
    }
  };
  const translatedScroll = () => {
    cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(() => {
      if (
        selecting.current ||
        !pane.current ||
        !control.current.canFollow("translation")
      )
        return;
      const v = pane.current.getBoundingClientRect(),
        y = v.top + v.height * 0.3;
      const nodes = Array.from(
        pane.current.querySelectorAll<HTMLElement>("[data-translation-block]"),
      );
      const node = nodes.find((n) => n.getBoundingClientRect().bottom > y);
      if (!node) return;
      const r = node.getBoundingClientRect(),
        anchor = {
          blockId: node.dataset.translationBlock!,
          fraction: Math.max(0, Math.min(1, (y - r.top) / (r.height || 1))),
        };
      reading.current = anchor;
      const block = blocks.find((b) => b.id === anchor.blockId);
      if (block)
        events.location(
          {
            type: "pdf",
            page: block.page,
            x: block.bounds.x,
            y: block.bounds.y + anchor.fraction * block.bounds.height,
          },
          block.page / Math.max(1, ...blocks.map((b) => b.page)),
        );
      if (sync && mode === "parallel") {
        control.current.following("source");
        void engine?.followBlock?.(anchor);
      }
    });
  };
  const changeMode = (value: Mode) => {
    setPopup(undefined);
    setMode(value);
  };
  const activePopup = popup && byId.get(popup.block.id);
  const toolbar = (
    <div className="translation-toolbar">
      <Tabs value={mode} onValueChange={(v) => changeMode(v as Mode)}>
        <TabsList>
          <TabsTrigger value="source">仅原文</TabsTrigger>
          <TabsTrigger value="parallel">原文译文</TabsTrigger>
          <TabsTrigger value="translation">仅译文</TabsTrigger>
        </TabsList>
      </Tabs>
      {mode === "parallel" && (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="交换原文和译文"
            title="交换原文和译文"
            onClick={() => setSwapped(!swapped)}
          >
            <ArrowLeftRight />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="同步滚动"
            title="同步滚动"
            aria-pressed={sync}
            onClick={() => setSync(!sync)}
          >
            {sync ? <Link2 /> : <Unlink2 />}
          </Button>
        </>
      )}
    </div>
  );
  return (
    <div className="pdf-reading" ref={root} data-theme={theme.mode}>
      {toolbarHost ? createPortal(toolbar, toolbarHost) : toolbar}
      <div
        className="translation-panes"
        data-mode={mode}
        data-swapped={swapped}
      >
        <div
          className="translation-source"
          inert={mode === "translation"}
          onWheelCapture={() => input("source")}
          onPointerDownCapture={() => input("source")}
          onKeyDownCapture={() => input("source")}
        >
          <ReaderView
            document={doc}
            theme={theme}
            annotations={annotations.filter(
              (a) => a.location.type !== "pdf" || !a.location.translation,
            )}
            blocks={blocks}
            onReady={ready}
            events={{
              ...events,
              selection: sourceSelection,
              columnFit: setFitted,
              location: (location, percentage) => {
                if (
                  state.current.mode !== "translation" &&
                  side.current === "source"
                )
                  events.location(location, percentage);
              },
              readingAnchor: (anchor) => {
                if (!control.current.canFollow("source") || selecting.current)
                  return;
                reading.current = anchor;
                if (state.current.sync && state.current.mode === "parallel")
                  followTranslation(anchor);
              },
              blockHover: (block) => {
                if (mode === "parallel") hover("source", block?.id);
              },
              blockAction: (block, action) => {
                if (action !== "translate") {
                  events.blockAction?.(block, action);
                  return;
                }
                const button = root.current?.querySelector<HTMLElement>(
                  `[data-block-id="${block.id}"] [data-block-action="translate"]`,
                );
                setPopup({
                  block,
                  rect:
                    button?.getBoundingClientRect() ??
                    root.current!.getBoundingClientRect(),
                });
              },
            }}
          />
          {mode === "parallel" && !fitted && (
            <Button
              className="fit-column"
              variant="secondary"
              size="sm"
              onClick={() =>
                void engine?.fitColumn?.().catch((e) => toast.error(e.message))
              }
            >
              <Columns2 />
              适合单栏
            </Button>
          )}
        </div>
        {mode !== "source" && (
          <div
            className="translation-document"
            ref={pane}
            tabIndex={0}
            aria-label="论文译文"
            onScroll={() => {
              hover("translation");
              translatedScroll();
            }}
            onPointerLeave={() => hover("translation")}
            onWheelCapture={() => input("translation")}
            onPointerDownCapture={() => {
              input("translation");
              hover("translation");
              selecting.current = true;
              selection.current = null;
              events.selection(null);
              setLinked(undefined);
              void engine?.focusSentences?.("", []);
            }}
            onPointerUp={translatedSelection}
            onKeyDownCapture={() => input("translation")}
            onKeyUp={translatedSelection}
            style={{
              fontSize: `${theme.fontSize}rem`,
              lineHeight: theme.lineHeight,
            }}
          >
            {error && <p role="alert">{error}</p>}
            {!visibleBlocks.length && (
              <p role="status">正文仍在解析中，完成的段落会在这里显示。</p>
            )}
            {processing?.incomplete && (
              <p className="translation-warning">
                部分页面没有可提取文字，需要 OCR；当前译文不完整。
              </p>
            )}
            {visibleBlocks.map((block) => {
              const translated = byId.get(block.id),
                noteIndexes = annotations.flatMap((a) => {
                  const mark =
                    a.location.type === "pdf"
                      ? a.location.translation
                      : undefined;
                  return mark
                    ? (mark.ranges ?? [mark])
                        .filter(
                          (r) =>
                            r.blockId === block.id &&
                            r.sourceHash === translated?.sourceHash,
                        )
                        .flatMap((r) => r.sentenceIndexes)
                    : [];
                });
              return (
                <section
                  key={block.id}
                  data-translation-block={block.id}
                  data-label={block.label}
                  data-hovered={hoveredBlock === block.id || undefined}
                  onPointerEnter={(event) => {
                    if (!event.buttons && !selecting.current)
                      hover("translation", block.id);
                  }}
                  onPointerMove={(event) => {
                    if (!event.buttons && !selecting.current)
                      hover("translation", block.id);
                  }}
                  onPointerLeave={() => hover("translation")}
                  className={noteIndexes.length ? "translation-annotated" : ""}
                >
                  <TranslationText
                    block={block}
                    translation={translated}
                    documentId={doc.id}
                    retry={() => void translate(block.id)}
                    linked={linked?.[block.id] ?? []}
                  />
                  {noteIndexes.length > 0 && (
                    <span
                      className="translation-note-indicator"
                      title="此段有已保存的标注"
                      aria-label="此段有已保存的标注"
                    />
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
      <Popover
        open={!!popup}
        onOpenChange={(open) => {
          if (!open) setPopup(undefined);
        }}
      >
        <PopoverContent
          anchor={
            popup ? { getBoundingClientRect: () => popup.rect } : undefined
          }
          className="translation-popover"
          side="bottom"
          align="end"
        >
          {popup && (
            <>
              <TranslationText
                block={popup.block}
                translation={activePopup}
                documentId={doc.id}
                retry={() => void translate(popup.block.id)}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  reading.current = { blockId: popup.block.id, fraction: 0 };
                  changeMode("parallel");
                }}
              >
                进入双栏对照
              </Button>
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

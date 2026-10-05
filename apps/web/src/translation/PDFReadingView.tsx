import { useEffect, useMemo, useRef, useState } from "react";
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
import { blockForRects, ReadingSync } from "../readers/pdf-reading";
import { TranslationText } from "./TranslationText";
import { paintTranslatedAnnotations } from "./annotations";
import "./translation.css";

type Mode = "source" | "parallel" | "translation";
export function PDFReadingView({
  document: doc,
  theme,
  annotations,
  blocks,
  processing,
  onReady,
  events,
}: {
  document: ReaderDocument;
  theme: ReaderTheme;
  annotations: Annotation[];
  blocks: PDFBlock[];
  processing?: Processing;
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
    [linked, setLinked] = useState<{ blockId: string; indexes: number[] }>();
  const [engine, setEngine] = useState<ReaderAdapter>();
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
  const initialRequest = useRef(false),
    selecting = useRef(false),
    selection = useRef<ReaderSelection | null>(null),
    scrollFrame = useRef(0);
  const visibleBlocks = blocks.filter(
    (b) => !["header", "footer", "number"].includes(b.label),
  );
  useEffect(() => {
    let alive = true,
      timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = await api.translations(doc.id);
        if (!alive) return;
        setTranslations(result);
        setError("");
        if (
          !initialRequest.current &&
          processing?.status === "complete" &&
          result.some((t) => t.status === "pending")
        ) {
          initialRequest.current = true;
          await api.translate(doc.id);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) timer = setTimeout(() => void refresh(), 1500);
      }
    };
    void refresh();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [doc.id, processing?.status]);
  const translate = async (blockId = "") => {
    try {
      await api.translate(doc.id, blockId);
      setTranslations(await api.translations(doc.id));
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
    selection.current = null;
    events.selection(null);
    window.getSelection()?.removeAllRanges();
    setLinked(undefined);
    void engine.focusSentences?.("", []);
    if (mode === "parallel") {
      void engine.fitColumn?.().catch((e) => toast.error(e.message));
      if (reading.current) followTranslation(reading.current);
    } else engine.stopColumnFit?.();
    if (mode === "translation" && reading.current)
      followTranslation(reading.current);
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
    const block = blockForRects(
      blocks,
      value.location.page,
      value.location.rects ?? [],
    );
    if (!block) return;
    const translation = byId.get(block.id),
      needle = value.text.replace(/\s/g, "").toLowerCase();
    let indexes =
      translation?.sentences.flatMap((s, i) =>
        s.source.replace(/\s/g, "").toLowerCase().includes(needle) ? [i] : [],
      ) ?? [];
    if (!indexes.length && translation) {
      const combined = translation.sentences
        .map((s) => s.source.replace(/\s/g, "").toLowerCase())
        .join("");
      const a = combined.indexOf(needle);
      if (a >= 0) {
        let pos = 0;
        indexes = translation.sentences.flatMap((s, i) => {
          const end = pos + s.source.replace(/\s/g, "").length,
            hit = pos < a + needle.length && end > a;
          pos = end;
          return hit ? [i] : [];
        });
      }
    }
    if (!indexes.length)
      indexes = translation?.sentences.map((_, i) => i) ?? [];
    setLinked({ blockId: block.id, indexes });
    reading.current = { blockId: block.id, fraction: 0 };
    if (mode === "parallel") followTranslation(reading.current, indexes[0]);
  };
  const translatedSelection = () => {
    selecting.current = false;
    const sel = window.getSelection(),
      text = sel?.toString().trim();
    if (!sel?.rangeCount || !text) return;
    const range = sel.getRangeAt(0),
      start = range.startContainer.parentElement?.closest<HTMLElement>(
        "[data-translation-block]",
      ),
      end = range.endContainer.parentElement?.closest<HTMLElement>(
        "[data-translation-block]",
      );
    if (!start || start !== end || !pane.current?.contains(start)) return;
    const block = blocks.find((b) => b.id === start.dataset.translationBlock),
      translation = byId.get(start.dataset.translationBlock!);
    if (!block || !translation || translation.status !== "complete") return;
    const sentences = Array.from(
        start.querySelectorAll<HTMLElement>("[data-sentence]"),
      ),
      indexes = sentences
        .filter((n) => range.intersectsNode(n))
        .map((n) => Number(n.dataset.sentence));
    if (!indexes.length) return;
    const rect = range.getBoundingClientRect(),
      before = range.cloneRange();
    before.selectNodeContents(start);
    before.setEnd(range.startContainer, range.startOffset);
    const offset = before.toString().length;
    const value: ReaderSelection = {
      text,
      anchor: {
        x: (rect.left + rect.right) / 2,
        top: rect.top,
        bottom: rect.bottom,
      },
      location: {
        type: "pdf",
        page: block.page,
        quote: indexes.map((i) => translation.sentences[i].source).join(" "),
        rects: [block.bounds],
        translation: {
          blockId: block.id,
          sourceHash: translation.sourceHash,
          sentenceIndexes: indexes,
          start: offset,
          end: offset + range.toString().length,
        },
      },
    };
    selection.current = value;
    events.selection(value);
    setLinked({ blockId: block.id, indexes });
    reading.current = { blockId: block.id, fraction: 0 };
    if (mode === "parallel") {
      control.current.following("source");
      void engine?.focusSentences?.(
        block.id,
        indexes.map((i) => translation.sentences[i].source),
        true,
      );
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
  return (
    <div className="pdf-reading" ref={root} data-theme={theme.mode}>
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
                if (byId.get(block.id)?.status !== "complete")
                  void translate(block.id);
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
            onScroll={translatedScroll}
            onWheelCapture={() => input("translation")}
            onPointerDownCapture={() => {
              input("translation");
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
                noteIndexes = annotations.flatMap((a) =>
                  a.location.type === "pdf" &&
                  a.location.translation?.blockId === block.id &&
                  a.location.translation.sourceHash === translated?.sourceHash
                    ? a.location.translation.sentenceIndexes
                    : [],
                );
              return (
                <section
                  key={block.id}
                  data-translation-block={block.id}
                  data-label={block.label}
                  className={noteIndexes.length ? "translation-annotated" : ""}
                >
                  <TranslationText
                    block={block}
                    translation={translated}
                    documentId={doc.id}
                    retry={() => void translate(block.id)}
                    linked={linked?.blockId === block.id ? linked.indexes : []}
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

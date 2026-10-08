import { useEffect, useId } from "react";
import type { RefObject } from "react";
import type {
  Annotation,
  PDFBlock,
  ReaderAdapter,
  ReaderEvents,
  TranslationBlock,
} from "@reader/core";
import { translatedAnnotationRanges } from "./annotations";
import {
  sourcePassage,
  translatedSentenceRanges,
  validParts,
} from "./sentence-links";

type Mark = { annotation: Annotation; range: Range };
const hit = (range: Range, x: number, y: number) =>
  Array.from(range.getClientRects()).some(
    (r) =>
      r.width &&
      r.height &&
      x >= r.left &&
      x <= r.right &&
      y >= r.top &&
      y <= r.bottom,
  );

/** Hover and saved cross-language marks share sentence geometry, never native selection. */
export function useSentenceMarks(
  root: RefObject<HTMLDivElement | null>,
  engine: ReaderAdapter | undefined,
  blocks: PDFBlock[],
  translations: TranslationBlock[],
  annotations: Annotation[],
  linked: boolean,
  mode: string,
  events: ReaderEvents,
) {
  const prefix = `reader-sentences-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  useEffect(() => {
    const host = root.current;
    if (!host || !engine || typeof Highlight === "undefined" || !CSS.highlights)
      return;
    const registry = CSS.highlights;
    const style = document.createElement("style");
    document.head.append(style);
    let marks: Mark[] = [],
      names: string[] = [],
      frame = 0;
    const cache = new Map<string, Range[]>();
    const sourceRanges = (t: TranslationBlock, i: number) => {
      const key = `${t.blockId}:${i}`;
      if (!cache.has(key))
        cache.set(key, engine.sentenceRanges?.([sourcePassage(t, i)]) ?? []);
      return cache.get(key)!;
    };
    const hoverName = `${prefix}-hover`;
    const clearHover = () => registry.delete(hoverName);
    const paint = () => {
      frame = 0;
      cache.clear();
      clearHover();
      names.forEach((name) => registry.delete(name));
      names = [];
      marks = translatedAnnotationRanges(host, annotations, translations);
      if (linked)
        for (const annotation of annotations) {
          if (
            annotation.kind === "bookmark" ||
            annotation.location.type !== "pdf"
          )
            continue;
          for (const part of validParts(
            annotation.location.sentenceLink,
            translations,
          )) {
            const t = translations.find((t) => t.blockId === part.blockId)!;
            const ranges =
              annotation.location.sentenceLink?.origin === "translation"
                ? sourceRanges(t, part.sentenceIndex)
                : translatedSentenceRanges(
                    host,
                    part.blockId,
                    part.sentenceIndex,
                  );
            marks.push(...ranges.map((range) => ({ annotation, range })));
          }
        }
      const groups = new Map<string, Range[]>();
      const rules = [
        `::highlight(${hoverName}) { background-color: rgb(128 128 128 / 22%); }`,
        `.textLayer ::highlight(${hoverName}) { color: transparent; }`,
      ];
      for (const mark of marks) {
        const color = /^#[\da-f]{6}$/i.test(mark.annotation.color)
          ? mark.annotation.color.toLowerCase()
          : "#e6b94c";
        const kind =
          mark.annotation.kind === "underline" ? "underline" : "highlight";
        const name = `${prefix}-${kind}-${color.slice(1)}`;
        if (!groups.has(name)) {
          groups.set(name, []);
          rules.push(
            `::highlight(${name}) { ${kind === "underline" ? `text-decoration: underline 2px ${color};` : `background-color: ${color}66;`} }`,
          );
          rules.push(`.textLayer ::highlight(${name}) { color: transparent; }`);
        }
        groups.get(name)!.push(mark.range);
      }
      style.textContent = rules.join("\n");
      for (const [name, ranges] of groups) {
        const highlight = new Highlight(...ranges);
        highlight.priority = 1;
        registry.set(name, highlight);
        names.push(name);
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(paint);
    };
    const move = (event: PointerEvent) => {
      clearHover();
      if (event.buttons || window.getSelection()?.toString().trim()) return;
      const target = event.target instanceof Element ? event.target : undefined;
      if (
        !target ||
        target.closest("a,button,input,textarea,[data-block-action]")
      )
        return;
      const translated = target.closest<HTMLElement>("[data-sentence]");
      let t: TranslationBlock | undefined,
        index = -1,
        fromTranslation = false;
      if (translated) {
        const blockId = translated.closest<HTMLElement>(
          "[data-translation-block]",
        )?.dataset.translationBlock;
        t = translations.find(
          (t) => t.blockId === blockId && t.status === "complete",
        );
        index = Number(translated.dataset.sentence);
        fromTranslation = true;
        // The full-width sentence container includes whitespace outside the text.
        if (
          !translatedSentenceRanges(host, blockId ?? "", index).some((r) =>
            hit(r, event.clientX, event.clientY),
          )
        )
          return;
      } else {
        const page = target.closest<HTMLElement>(".page[data-page-number]");
        if (!page) return;
        const rect = page.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width,
          y = (event.clientY - rect.top) / rect.height;
        const block = blocks.find(
          (b) =>
            b.page === Number(page.dataset.pageNumber) &&
            x >= b.bounds.x &&
            x <= b.bounds.x + b.bounds.width &&
            y >= b.bounds.y &&
            y <= b.bounds.y + b.bounds.height,
        );
        t = translations.find(
          (t) => t.blockId === block?.id && t.status === "complete",
        );
        if (!t && block?.text && !block.image) {
          t = {
            blockId: block.id,
            sourceHash: "",
            status: "complete",
            sentences: Array.from(
              new Intl.Segmenter(undefined, {
                granularity: "sentence",
              }).segment(block.text),
              (s) => ({ source: s.segment, target: "" }),
            ),
          };
        }
        if (t)
          index = t.sentences.findIndex((_, i) =>
            sourceRanges(t!, i).some((r) =>
              hit(r, event.clientX, event.clientY),
            ),
          );
      }
      if (!t || index < 0 || !t.sentences[index]) return;
      const ranges = [
        ...(!fromTranslation || linked ? sourceRanges(t, index) : []),
        ...(fromTranslation || linked
          ? translatedSentenceRanges(host, t.blockId, index)
          : []),
      ];
      registry.set(hoverName, new Highlight(...ranges));
    };
    let pressed: { x: number; y: number } | undefined;
    const down = (event: PointerEvent) => {
      clearHover();
      pressed =
        event.button === 0 ? { x: event.clientX, y: event.clientY } : undefined;
    };
    const click = (event: MouseEvent) => {
      const start = pressed;
      pressed = undefined;
      if (
        !start ||
        Math.hypot(start.x - event.clientX, start.y - event.clientY) > 5 ||
        window.getSelection()?.toString().trim()
      )
        return;
      const target = event.target instanceof Element ? event.target : undefined;
      if (target?.closest("a,button,input,textarea,[data-block-action]"))
        return;
      const matches = marks.filter((m) =>
        hit(m.range, event.clientX, event.clientY),
      );
      if (!matches.length) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = matches[0].range.getBoundingClientRect();
      events.annotation?.({
        ids: [...new Set(matches.map((m) => m.annotation.id))],
        anchor: { x: event.clientX, top: rect.top, bottom: rect.bottom },
      });
    };
    const observer = new MutationObserver(schedule);
    observer.observe(host, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const resize = new ResizeObserver(schedule);
    resize.observe(host);
    paint();
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", clearHover);
    host.addEventListener("pointerdown", down, true);
    host.addEventListener("click", click, true);
    host.addEventListener("scroll", clearHover, true);
    return () => {
      observer.disconnect();
      resize.disconnect();
      cancelAnimationFrame(frame);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", clearHover);
      host.removeEventListener("pointerdown", down, true);
      host.removeEventListener("click", click, true);
      host.removeEventListener("scroll", clearHover, true);
      clearHover();
      names.forEach((name) => registry.delete(name));
      style.remove();
    };
  }, [
    root,
    engine,
    blocks,
    translations,
    annotations,
    linked,
    mode,
    events.annotation,
    prefix,
  ]);
}

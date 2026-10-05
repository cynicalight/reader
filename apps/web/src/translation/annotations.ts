import type { Annotation, TranslationBlock } from "@reader/core";

export function textRange(
  root: HTMLElement,
  start: number,
  end: number,
): Range | undefined {
  if (start < 0 || end <= start) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0,
    first: { node: Text; offset: number } | undefined;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const size = node.textContent?.length ?? 0;
    if (!first && start < offset + size)
      first = { node: node as Text, offset: start - offset };
    if (first && end <= offset + size) {
      const range = document.createRange();
      range.setStart(first.node, first.offset);
      range.setEnd(node, end - offset);
      return range;
    }
    offset += size;
  }
}

// Source hashes prevent old marks from being attached to unrelated regenerated text.
export function translatedAnnotationRanges(
  host: HTMLElement,
  annotations: Annotation[],
  translations: TranslationBlock[],
) {
  const result: { annotation: Annotation; range: Range }[] = [];
  for (const annotation of annotations) {
    const mark =
      annotation.location.type === "pdf"
        ? annotation.location.translation
        : undefined;
    if (
      !mark ||
      !translations.some(
        (t) =>
          t.blockId === mark.blockId &&
          t.sourceHash === mark.sourceHash &&
          t.status === "complete",
      )
    )
      continue;
    const node = Array.from(
      host.querySelectorAll<HTMLElement>("[data-translation-block]"),
    ).find((n) => n.dataset.translationBlock === mark.blockId);
    if (!node) continue;
    const range = textRange(node, mark.start, mark.end);
    if (range?.toString().trim() === annotation.quote.trim())
      result.push({ annotation, range });
  }
  return result;
}

export function paintTranslatedAnnotations(
  host: HTMLElement,
  annotations: Annotation[],
  translations: TranslationBlock[],
) {
  const api = (
    globalThis.CSS as unknown as
      { highlights?: Map<string, unknown> } | undefined
  )?.highlights;
  const Highlight = (
    globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }
  ).Highlight;
  if (!api || !Highlight) return;
  const ranges = translatedAnnotationRanges(host, annotations, translations);
  api.set(
    "reader-translation-marks",
    new Highlight(
      ...ranges
        .filter((r) => r.annotation.kind !== "underline")
        .map((r) => r.range),
    ),
  );
  api.set(
    "reader-translation-underlines",
    new Highlight(
      ...ranges
        .filter((r) => r.annotation.kind === "underline")
        .map((r) => r.range),
    ),
  );
  return () => {
    api.delete("reader-translation-marks");
    api.delete("reader-translation-underlines");
  };
}

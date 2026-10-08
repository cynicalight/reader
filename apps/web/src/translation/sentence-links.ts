import type {
  PDFLocation,
  PDFPassage,
  PDFSentenceLink,
  ReaderSelection,
  TranslationBlock,
} from "@reader/core";

export function sentenceLink(
  links: PDFSentenceLink[],
  translations: TranslationBlock[],
  origin: "source" | "translation",
): PDFLocation["sentenceLink"] {
  const parts = links.flatMap((link) => {
    const block = translations.find(
      (t) => t.blockId === link.blockId && t.status === "complete",
    );
    if (!block) return [];
    return [...new Set(link.sentenceIndexes)].flatMap((sentenceIndex) => {
      const sentence = block.sentences[sentenceIndex];
      return sentence
        ? [
            {
              blockId: block.blockId,
              sourceHash: block.sourceHash,
              sentenceIndex,
              ...sentence,
            },
          ]
        : [];
    });
  });
  return parts.length ? { origin, parts } : undefined;
}

export function validParts(
  link: PDFLocation["sentenceLink"],
  translations: TranslationBlock[],
) {
  return (link?.parts ?? []).filter((part) => {
    const t = translations.find(
      (t) =>
        t.blockId === part.blockId &&
        t.sourceHash === part.sourceHash &&
        t.status === "complete",
    );
    const sentence = t?.sentences[part.sentenceIndex];
    // Keep the saved excerpt in notes, but never attach it to a changed translation.
    return sentence?.source === part.source && sentence.target === part.target;
  });
}

export function sourcePassage(
  block: TranslationBlock,
  index: number,
): PDFPassage {
  return {
    blockId: block.blockId,
    sources: [block.sentences[index].source],
    sourceOffset: block.sentences
      .slice(0, index)
      .map((s) => s.source)
      .join("")
      .toLowerCase()
      .replace(/[\s\u00ad]/g, "").length,
  };
}

export function linkTranslatedSelection(
  selection: ReaderSelection,
  translations: TranslationBlock[],
): ReaderSelection {
  if (selection.location.type !== "pdf" || !selection.location.translation)
    return selection;
  if (selection.location.sentenceLink) return selection;
  const mark = selection.location.translation;
  const ranges = (mark.ranges ?? [mark]).filter((part) =>
    translations.some(
      (t) =>
        t.blockId === part.blockId &&
        t.sourceHash === part.sourceHash &&
        t.status === "complete",
    ),
  );
  return {
    ...selection,
    location: {
      ...selection.location,
      sentenceLink: sentenceLink(ranges, translations, "translation"),
    },
  };
}

export function translatedSentenceRanges(
  host: HTMLElement,
  blockId: string,
  index: number,
): Range[] {
  const block = Array.from(
    host.querySelectorAll<HTMLElement>("[data-translation-block]"),
  ).find((n) => n.dataset.translationBlock === blockId);
  const sentence = block?.querySelector(`[data-sentence="${index}"]`);
  if (!sentence) return [];
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(sentence, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!node.textContent?.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    ranges.push(range);
  }
  return ranges;
}

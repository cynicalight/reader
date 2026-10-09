import type { EPUBLocation, EPUBReadingBlock } from "@reader/core";
import { epubOffsets } from "../translation/epub-links";

export type EPUBSlice = { block: EPUBReadingBlock; start: number; end: number };

/** Resolve in memory only. Ambiguous legacy quotes must never move a note. */
export function resolveEPUBLocation(
  location: EPUBLocation,
  blocks: EPUBReadingBlock[],
): EPUBSlice[] {
  const chapter = blocks.filter(
    (b) => b.location.href === location.href.split("#")[0],
  );
  if (location.blockId) {
    const first = blocks.findIndex(
      (b) =>
        b.id === location.blockId &&
        b.location.href === location.href.split("#")[0],
    );
    const last = blocks.findIndex(
      (b) => b.id === (location.endBlockId ?? location.blockId),
    );
    if (first < 0 || last < first) return [];
    const selected = blocks.slice(first, last + 1);
    const start = location.start ?? 0,
      end = location.end ?? selected.at(-1)!.text.length;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < 0 ||
      start > selected[0].text.length ||
      end > selected.at(-1)!.text.length ||
      (first === last && end < start)
    )
      return [];
    return selected.map((block, i) => ({
      block,
      start: i === 0 ? start : 0,
      end: i === selected.length - 1 ? end : block.text.length,
    }));
  }
  const offsets = epubOffsets(location);
  if (offsets) {
    const slices = chapter.flatMap((block) => {
      const range = epubOffsets(block.location);
      return range && range.start < offsets.end && offsets.start < range.end
        ? [
            {
              block,
              start: Math.max(0, offsets.start - range.start),
              end: Math.min(block.text.length, offsets.end - range.start),
            },
          ]
        : [];
    });
    if (slices.length) return slices;
  }
  let quote = location.quote;
  try {
    quote ||= JSON.parse(location.locator || "{}").text?.highlight;
  } catch {
    /* Old malformed locators may still carry a quote. */
  }
  if (!quote) return [];
  const normalized = quote.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  let text = "";
  const positions: { block: number; offset: number }[] = [];
  chapter.forEach((block, index) => {
    if (block.image) return;
    if (text && !text.endsWith(" ")) {
      text += " ";
      positions.push({ block: index, offset: 0 });
    }
    for (let offset = 0; offset < block.text.length; offset++) {
      const char = /\s/.test(block.text[offset]) ? " " : block.text[offset];
      if (char === " " && text.endsWith(" ")) continue;
      text += char;
      positions.push({ block: index, offset });
    }
  });
  const at = text.indexOf(normalized);
  if (at < 0 || text.indexOf(normalized, at + 1) >= 0) return [];
  const first = positions[at],
    last = positions[at + normalized.length - 1];
  return chapter.slice(first.block, last.block + 1).map((block, i) => ({
    block,
    start: i === 0 ? first.offset : 0,
    end: first.block + i === last.block ? last.offset + 1 : block.text.length,
  }));
}

export function blockPieces(host: HTMLElement, id: string) {
  const nodes = Array.from(
    host.querySelectorAll<HTMLElement>("[data-epub-run]"),
  )
    .filter((n) => n.dataset.epubRun === id)
    .flatMap((n) =>
      Array.from(n.childNodes).filter(
        (c): c is Text => c.nodeType === Node.TEXT_NODE,
      ),
    );
  const text = nodes.map((n) => n.data).join("");
  return { nodes, leading: text.length - text.trimStart().length };
}

export function blockRange(
  host: HTMLElement,
  slice: EPUBSlice,
): Range | undefined {
  const { nodes, leading } = blockPieces(host, slice.block.id);
  const point = (offset: number, end: boolean): [Text, number] | undefined => {
    let at = offset + leading;
    for (const node of nodes) {
      if (at < node.length || (end && at === node.length)) return [node, at];
      at -= node.length;
    }
    const last = nodes.at(-1);
    return last ? [last, last.length] : undefined;
  };
  const start = point(slice.start, false),
    end = point(slice.end, true);
  if (!start || !end) return;
  const range = document.createRange();
  range.setStart(...start);
  range.setEnd(...end);
  return range;
}

export function blockOffset(
  host: HTMLElement,
  block: EPUBReadingBlock,
  node: Node,
  offset: number,
) {
  const { nodes, leading } = blockPieces(host, block.id);
  let at = 0;
  for (const text of nodes) {
    if (text === node) {
      at += offset;
      break;
    }
    const range = document.createRange();
    range.selectNodeContents(text);
    if (range.comparePoint(node, offset) <= 0) break;
    at += text.length;
  }
  return Math.max(0, Math.min(block.text.length, at - leading));
}

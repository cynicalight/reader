import { Locator } from "@readium/shared";

function selector(element: Element): string {
  const parts: string[] = [];
  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  ) {
    const tag = current.localName;
    const peers = current.parentElement
      ? Array.from(current.parentElement.children).filter(
          (s) => s.localName === tag,
        )
      : [current];
    parts.unshift(`${tag}:nth-of-type(${peers.indexOf(current) + 1})`);
  }
  return parts.join(" > ");
}
function point(node: Node, offset: number) {
  if (node.nodeType !== 3 || !node.parentElement) return undefined;
  const siblings = Array.from(node.parentElement.childNodes).filter(
    (child) => child.nodeType === 3,
  );
  return {
    cssSelector: selector(node.parentElement),
    textNodeIndex: siblings.indexOf(node as ChildNode),
    charOffset: offset,
  };
}

/** Offsets use DOM UTF-16 text, including whitespace, never rendered page numbers. */
function rangeAt(doc: Document, start: number, end: number): Range | undefined {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start
  )
    return;
  const walker = doc.createTreeWalker(doc.body, 4 /* SHOW_TEXT */);
  const range = doc.createRange();
  let offset = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!started && start < offset + length) {
      range.setStart(node, start - offset);
      started = true;
    }
    if (started && end <= offset + length) {
      range.setEnd(node, end - offset);
      return range;
    }
    offset += length;
  }
}

export function selectionLocator(
  base: Locator,
  selected: Range,
): Locator | undefined {
  const doc = selected.startContainer.ownerDocument;
  if (
    !doc?.body ||
    selected.collapsed ||
    !doc.body.contains(selected.commonAncestorContainer)
  )
    return;
  const before = doc.createRange();
  before.selectNodeContents(doc.body);
  before.setEnd(selected.startContainer, selected.startOffset);
  const offset = before.toString().length;
  const text = selected.toString();
  if (!text.trim()) return;
  // Element endpoints (selectNodeContents, keyboard selection, mixed markup)
  // become text endpoints without modifying the publication DOM.
  const range = rangeAt(doc, offset, offset + text.length);
  if (!range) return;
  const start = point(range.startContainer, range.startOffset);
  const end = point(range.endContainer, range.endOffset);
  if (!start || !end) return;
  const after = doc.createRange();
  after.selectNodeContents(doc.body);
  after.setStart(range.endContainer, range.endOffset);
  return Locator.deserialize({
    ...base.serialize(),
    locations: {
      ...base.locations.serialize(),
      domRange: { start, end },
      textRange: { start: offset, end: offset + text.length },
    },
    text: {
      highlight: text,
      before: before.toString().slice(-64),
      after: after.toString().slice(0, 64),
    },
  });
}

type DOMPoint = {
  cssSelector: string;
  textNodeIndex: number;
  charOffset: number;
};
function resolvePoint(doc: Document, point: DOMPoint) {
  if (
    !point ||
    !Number.isInteger(point.textNodeIndex) ||
    !Number.isInteger(point.charOffset) ||
    point.textNodeIndex < 0 ||
    point.charOffset < 0
  )
    return;
  const element = doc.querySelector(point.cssSelector);
  if (!element || !doc.body.contains(element)) return;
  const node = Array.from(element.childNodes).filter((n) => n.nodeType === 3)[
    point.textNodeIndex
  ];
  if (node && point.charOffset <= (node.textContent?.length ?? 0)) return node;
}

/** Resolve without silently choosing the first of several identical quotations. */
export function resolveEPUBRange(
  doc: Document,
  locator: Locator,
): Range | undefined {
  const quote = locator.text?.highlight;
  if (!quote) return;
  const text = doc.body.textContent ?? "";
  const contextMatches = (start: number, end: number) =>
    (!locator.text?.before ||
      text.slice(0, start).endsWith(locator.text.before)) &&
    (!locator.text?.after || text.slice(end).startsWith(locator.text.after));
  const saved = locator.locations.otherLocations?.get("domRange") as
    { start: DOMPoint; end: DOMPoint } | undefined;
  if (saved) {
    try {
      const start = resolvePoint(doc, saved.start);
      const end = resolvePoint(doc, saved.end);
      if (start && end) {
        const range = doc.createRange();
        range.setStart(start, saved.start.charOffset);
        range.setEnd(end, saved.end.charOffset);
        if (range.toString() === quote) {
          const prefix = doc.createRange();
          prefix.selectNodeContents(doc.body);
          prefix.setEnd(range.startContainer, range.startOffset);
          const offset = prefix.toString().length;
          if (contextMatches(offset, offset + quote.length)) return range;
        }
      }
    } catch {
      /* Invalid or stale DOM paths fall back to quotation matching. */
    }
  }
  const matches: number[] = [];
  const contextual: number[] = [];
  for (
    let offset = text.indexOf(quote);
    offset !== -1;
    offset = text.indexOf(quote, offset + 1)
  ) {
    matches.push(offset);
    if (contextMatches(offset, offset + quote.length)) contextual.push(offset);
  }
  const candidates = contextual.length ? contextual : matches;
  if (candidates.length !== 1) return;
  return rangeAt(doc, candidates[0]!, candidates[0]! + quote.length);
}

/** Search hits become exact locators so repeated words remain separate results. */
export function searchEPUBLocators(
  doc: Document,
  base: Locator,
  query: string,
  limit = 100,
): Locator[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const pattern = words
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const results: Locator[] = [];
  for (const match of (doc.body.textContent ?? "").matchAll(
    new RegExp(pattern, "giu"),
  )) {
    const range = rangeAt(doc, match.index, match.index + match[0].length);
    const locator = range && selectionLocator(base, range);
    if (locator) results.push(locator);
    if (results.length >= limit) break;
  }
  return results;
}

export function sliceEPUBRange(range: Range, start: number, end: number) {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > range.toString().length
  )
    return;
  const doc = range.startContainer.ownerDocument!;
  const prefix = doc.createRange();
  prefix.selectNodeContents(doc.body);
  prefix.setEnd(range.startContainer, range.startOffset);
  const offset = prefix.toString().length;
  return rangeAt(doc, offset + start, offset + end);
}

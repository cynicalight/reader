/**
 * Double click selects a word natively; these helpers grow that selection to
 * the whole sentence around it, using the platform's sentence segmentation.
 */

interface Piece {
  node: Text;
  /** Offset of the node's first character in the joined text. */
  start: number;
}

/**
 * The text under `root` with line breaks (<br>) read as spaces, so a sentence
 * ending at a line end still ends there and words across lines stay apart.
 */
function readText(root: Element) {
  const pieces: Piece[] = [];
  let text = "";
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      pieces.push({ node: node as Text, start: text.length });
      text += (node as Text).data;
    } else if ((node as Element).tagName === "BR" && !/\s$/.test(text)) {
      text += " ";
    }
  }
  return { text, pieces };
}

function offsetOf(pieces: Piece[], node: Node, offset: number) {
  // An element position points before its offset-th child: use the first
  // text inside that child.
  if (node.nodeType !== Node.TEXT_NODE) {
    const child = node.childNodes[offset] ?? node;
    const piece = pieces.find(
      (p) => child === p.node || child.contains(p.node),
    );
    return piece ? piece.start : -1;
  }
  const piece = pieces.find((p) => p.node === node);
  return piece ? piece.start + offset : -1;
}

/** The text node and offset for a position in the joined text. */
function positionAt(pieces: Piece[], offset: number, end: boolean) {
  for (let i = 0; i < pieces.length; i++) {
    const { node, start } = pieces[i];
    const stop = start + node.data.length;
    // An end position on a boundary stays in the earlier node.
    if (offset < stop || (end && offset === stop))
      return { node, offset: Math.max(0, offset - start) };
  }
  const last = pieces.at(-1);
  return last ? { node: last.node, offset: last.node.data.length } : undefined;
}

/** [start, end) of the sentence containing `offset`, without edge spaces. */
export function sentenceBounds(text: string, offset: number) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
  for (const { segment, index } of segmenter.segment(text)) {
    if (offset < index || offset >= index + segment.length) continue;
    const lead = segment.length - segment.trimStart().length;
    return {
      start: index + lead,
      end: index + segment.trimEnd().length,
    };
  }
  return undefined;
}

/**
 * Grow the current selection inside `root` to its whole sentence. Returns
 * false and leaves the selection alone when it is not inside `root`.
 */
export function selectSentence(selection: Selection | null, root: Element) {
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return false;
  const { text, pieces } = readText(root);
  const at = offsetOf(pieces, range.startContainer, range.startOffset);
  if (at < 0) return false;
  const bounds = sentenceBounds(text, at);
  if (!bounds || bounds.end <= bounds.start) return false;
  const start = positionAt(pieces, bounds.start, false);
  const end = positionAt(pieces, bounds.end, true);
  if (!start || !end) return false;
  const sentence = root.ownerDocument.createRange();
  sentence.setStart(start.node, start.offset);
  sentence.setEnd(end.node, end.offset);
  selection.removeAllRanges();
  selection.addRange(sentence);
  return true;
}

const blockTags = new Set([
  "P",
  "LI",
  "DD",
  "DT",
  "BLOCKQUOTE",
  "FIGCAPTION",
  "TD",
  "TH",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "PRE",
  "DIV",
  "SECTION",
  "ARTICLE",
  "BODY",
]);

/** The nearest block element, so EPUB sentences stay within a paragraph. */
export function sentenceRoot(node: Node | null) {
  let element = node instanceof Element ? node : (node?.parentElement ?? null);
  while (element && !blockTags.has(element.tagName))
    element = element.parentElement;
  return element;
}

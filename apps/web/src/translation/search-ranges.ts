/** Find literal matches within text-node ranges without changing DOM or selection. */
export function searchRanges(ranges: Range[], query: string): Range[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const pieces = ranges
    .filter(
      (range) =>
        range.startContainer === range.endContainer &&
        range.startContainer.nodeType === Node.TEXT_NODE,
    )
    .map((range) => ({ range, text: range.toString() }));
  const text = pieces
    .map((piece) => piece.text)
    .join("")
    .toLocaleLowerCase();
  const matches: Range[] = [];
  let from = 0;
  while (from < text.length) {
    const start = text.indexOf(needle, from);
    if (start < 0) break;
    const end = start + needle.length;
    let offset = 0;
    for (const piece of pieces) {
      const pieceEnd = offset + piece.text.length;
      const left = Math.max(start, offset);
      const right = Math.min(end, pieceEnd);
      if (left < right) {
        const range = document.createRange();
        range.setStart(
          piece.range.startContainer,
          piece.range.startOffset + left - offset,
        );
        range.setEnd(
          piece.range.endContainer,
          piece.range.startOffset + right - offset,
        );
        matches.push(range);
      }
      offset = pieceEnd;
      if (offset >= end) break;
    }
    from = end;
  }
  return matches;
}

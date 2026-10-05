import {
  isPDFPageDecoration,
  type PDFBlock,
  type PDFLocation,
} from "@reader/core";

export type Box = NonNullable<PDFLocation["rects"]>[number];
export interface TextRun {
  text: string;
  bounds: Box;
}
export const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
export function union(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x)),
    y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
}

// Infer a gutter from repeated text on both sides, excluding wide headings.
// Returns reading regions with full-width bands kept in their original order.
export function readingColumns(
  runs: TextRun[],
  blocks: PDFBlock[] = [],
  neighbors: TextRun[] = [],
): Box[] {
  const decorations = blocks.filter(isPDFPageDecoration);
  const body = runs.filter((r) => {
    if (!r.text.trim() || r.bounds.width <= 0.015) return false;
    const covers = (b: Box) =>
      overlap(r.bounds, b) / (r.bounds.width * r.bounds.height || 1) > 0.5;
    if (decorations.some((b) => covers(b.bounds))) return false;
    if (blocks.some((b) => !["", "text"].includes(b.label) && covers(b.bounds)))
      return true;
    if (isPDFPageDecoration({ ...r, label: "text" })) return false;
    const edge = r.bounds.y < 0.08 || r.bounds.y + r.bounds.height > 0.92;
    // Repeated margin text is a conservative fallback before Paddle is ready.
    return (
      !edge ||
      !neighbors.some(
        (n) =>
          normalized(n.text) === normalized(r.text) &&
          Math.abs(n.bounds.y - r.bounds.y) < 0.015,
      )
    );
  });
  if (!body.length) {
    const content = blocks.filter(
      (b) => !isPDFPageDecoration(b) && (b.image || b.text.trim()),
    );
    if (content.length) return [union(content.map((b) => b.bounds))];
    // Even scans can have a text page number. Without layout evidence retain the page.
    return blocks.length > 0 && blocks.every(isPDFPageDecoration)
      ? []
      : [{ x: 0, y: 0, width: 1, height: 1 }];
  }
  const boxes = body.map((r) => r.bounds),
    all = union(boxes);
  let split: number | undefined,
    best = 0;
  for (let x = 0.35; x <= 0.65; x += 0.01) {
    const left = boxes.filter((b) => b.x + b.width <= x - 0.012),
      right = boxes.filter((b) => b.x >= x + 0.012);
    const crossing = boxes.filter((b) => b.x < x && b.x + b.width > x);
    if (
      left.length < 6 ||
      right.length < 6 ||
      crossing.length > boxes.length * 0.18
    )
      continue;
    const lb = union(left),
      rb = union(right);
    if (
      lb.width < 0.15 ||
      rb.width < 0.15 ||
      Math.min(lb.y + lb.height, rb.y + rb.height) - Math.max(lb.y, rb.y) < 0.15
    )
      continue;
    const score = Math.min(left.length, right.length) - crossing.length * 3;
    if (score > best) {
      best = score;
      split = x;
    }
  }
  if (split === undefined) return [all];
  const wide = boxes.filter(
    (b) => b.x < split! - 0.012 && b.x + b.width > split! + 0.012,
  );
  const bands: Box[] = [];
  for (const b of wide.sort((a, b) => a.y - b.y)) {
    const prev = bands.at(-1);
    if (prev && b.y <= prev.y + prev.height + 0.02)
      bands[bands.length - 1] = union([prev, b]);
    else bands.push(b);
  }
  const result: Box[] = [];
  let top = 0;
  const addColumns = (bottom: number) => {
    for (const side of [0, 1]) {
      const set = boxes.filter(
        (b) =>
          b.y + b.height / 2 >= top &&
          b.y + b.height / 2 < bottom &&
          (side === 0
            ? b.x + b.width <= split! + 0.012
            : b.x >= split! - 0.012),
      );
      if (set.length) result.push(union(set));
    }
  };
  for (const band of bands) {
    addColumns(band.y);
    result.push(band);
    top = band.y + band.height;
  }
  addColumns(1);
  return result.length ? result : [all];
}

export function hasParallelColumns(regions: Box[]) {
  return regions.some((a, i) =>
    regions
      .slice(i + 1)
      .some(
        (b) =>
          (a.x + a.width < b.x || b.x + b.width < a.x) &&
          Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.1,
      ),
  );
}

export function columnReadingScale(
  regions: Box[],
  viewportWidth: number,
  pageWidth: number,
) {
  if (hasParallelColumns(regions)) return 1.5;
  // PDFViewer scales PDF points into CSS pixels before applying its zoom.
  return Math.min(
    5,
    Math.max(
      0.25,
      (viewportWidth - 32) / (pageWidth * (96 / 72) * union(regions).width),
    ),
  );
}

function normalized(text: string) {
  return text.toLowerCase().replace(/[\s\u00ad]/g, "");
}
// Map sentence text back into text runs inside its paragraph. Repeated phrases
// outside the block cannot capture an anchor. Low-confidence matches use the block.
export function sentenceBoxes(
  block: PDFBlock,
  sources: string[],
  runs: TextRun[],
  sourceOffset = 0,
): Box[] {
  const selected = runs
    .filter(
      (r) =>
        overlap(r.bounds, block.bounds) /
          (r.bounds.width * r.bounds.height || 1) >
        0.5,
    )
    .sort((a, b) =>
      Math.abs(a.bounds.y - b.bounds.y) <
      Math.min(a.bounds.height, b.bounds.height) * 0.45
        ? a.bounds.x - b.bounds.x
        : a.bounds.y - b.bounds.y,
    );
  const text = selected.map((r) => normalized(r.text)).join("");
  const result: Box[] = [];
  let cursor = sourceOffset;
  for (const source of sources) {
    const needle = normalized(source);
    if (!needle) continue;
    const start = text.indexOf(needle, cursor);
    if (start < 0) return [block.bounds];
    const end = start + needle.length;
    cursor = end;
    let offset = 0;
    for (const run of selected) {
      const size = normalized(run.text).length;
      const a = Math.max(start, offset),
        b = Math.min(end, offset + size);
      if (a < b) {
        // Geometry is deliberately run-level: glyph widths are not uniform.
        result.push(run.bounds);
      }
      offset += size;
    }
  }
  return result.length ? result : [block.bounds];
}
export function blockForRects(blocks: PDFBlock[], page: number, rects: Box[]) {
  return blocks
    .filter((b) => b.page === page && !b.image && !isPDFPageDecoration(b))
    .map((block) => ({
      block,
      score: rects.reduce((v, r) => v + overlap(block.bounds, r), 0),
    }))
    .sort((a, b) => b.score - a.score)
    .find((v) => v.score > 0)?.block;
}

// A fresh gesture is required after a column transition. Trackpad inertia
// extends the quiet interval; elapsed time alone never advances a second column.
export class ColumnGesture {
  private last = 0;
  private changed = false;
  accept(now: number) {
    if (now - this.last > 180) this.changed = false;
    this.last = now;
    return !this.changed;
  }
  transition() {
    this.changed = true;
  }
}

export class ReadingSync {
  private owner: "source" | "translation" = "source";
  private until = 0;
  private blocked: "source" | "translation" | undefined;
  input(side: "source" | "translation") {
    this.owner = side;
    this.blocked = undefined;
    this.until = 0;
  }
  canFollow(side: "source" | "translation", now = performance.now()) {
    return this.owner === side && !(this.blocked === side && now < this.until);
  }
  following(side: "source" | "translation", now = performance.now()) {
    this.blocked = side;
    this.until = now + 700;
  }
}

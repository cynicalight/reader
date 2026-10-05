import { describe, expect, it } from "vitest";
import {
  ColumnGesture,
  columnReadingScale,
  ReadingSync,
  readingColumns,
  sentenceBoxes,
  type TextRun,
} from "./pdf-reading";

const rows = (x: number): TextRun[] =>
  Array.from({ length: 12 }, (_, i) => ({
    text: `Text line ${i}`,
    bounds: { x, y: 0.2 + i * 0.045, width: 0.37, height: 0.02 },
  }));
describe("PDF column reading", () => {
  it("keeps full-width title before left and right body columns", () => {
    const columns = readingColumns([
      {
        text: "Title spanning two columns",
        bounds: { x: 0.1, y: 0.05, width: 0.8, height: 0.04 },
      },
      ...rows(0.08),
      ...rows(0.55),
    ]);
    expect(columns).toHaveLength(3);
    expect(columns.map((b) => b.x)).toEqual([0.1, 0.08, 0.55]);
  });
  it("does not infer a second column in a single-column page", () => {
    const columns = readingColumns(
      rows(0.15).map((r) => ({ ...r, bounds: { ...r.bounds, width: 0.7 } })),
    );
    expect(columns).toHaveLength(1);
  });
  it("requires a quiet interval after switching columns despite continuing inertia", () => {
    const gesture = new ColumnGesture();
    expect(gesture.accept(1000)).toBe(true);
    gesture.transition();
    for (const time of [1020, 1080, 1200, 1330, 1480])
      expect(gesture.accept(time)).toBe(false);
    expect(gesture.accept(1750)).toBe(true);
  });
});
it("never feeds programmatic scrolling back and transfers control on user input", () => {
  const sync = new ReadingSync();
  sync.input("source");
  sync.following("translation", 0);
  expect(sync.canFollow("translation", 100)).toBe(false);
  expect(sync.canFollow("translation", 1000)).toBe(false);
  sync.input("translation");
  expect(sync.canFollow("translation", 1001)).toBe(true);
  sync.following("source", 1001);
  expect(sync.canFollow("source", 1100)).toBe(false);
});
it("bounds sentence matching to the source paragraph and falls back when no exact text exists", () => {
  const bounds = { x: 0.1, y: 0.2, width: 0.4, height: 0.2 };
  const block = {
    id: "p1-b1",
    page: 1,
    label: "text",
    text: "First. Second.",
    bounds,
  };
  const first = { x: 0.1, y: 0.22, width: 0.3, height: 0.02 },
    second = { x: 0.1, y: 0.25, width: 0.35, height: 0.02 };
  const runs = [
    { text: "First.", bounds: first },
    { text: "Second.", bounds: second },
    { text: "Second.", bounds: { ...second, x: 0.6 } },
  ];
  expect(sentenceBoxes(block, ["Second."], runs)).toEqual([second]);
  expect(sentenceBoxes(block, ["Missing."], runs)).toEqual([bounds]);
});
it("locates the second identical sentence using its source offset", () => {
  const first = { x: 0.1, y: 0.2, width: 0.3, height: 0.02 },
    second = { ...first, y: 0.24 };
  const block = {
    id: "a",
    page: 1,
    label: "text",
    text: "Same. Same.",
    bounds: { ...first, height: 0.1 },
  };
  expect(
    sentenceBoxes(
      block,
      ["Same."],
      [
        { text: "Same.", bounds: first },
        { text: "Same.", bounds: second },
      ],
      5,
    ),
  ).toEqual([second]);
});
it("excludes labeled page furniture and edge page numbers while keeping footnotes", () => {
  const body = rows(0.15).map((r) => ({
    ...r,
    bounds: { ...r.bounds, width: 0.7 },
  }));
  const header = {
    text: "Proceedings of VLDB",
    bounds: { x: 0.1, y: 0.06, width: 0.8, height: 0.02 },
  };
  const footer = {
    text: "Publisher notice",
    bounds: { x: 0.2, y: 0.93, width: 0.6, height: 0.02 },
  };
  const footnote = {
    text: "1 A substantive footnote.",
    bounds: { x: 0.15, y: 0.86, width: 0.65, height: 0.025 },
  };
  const blocks = [header, footer, footnote].map((r, i) => ({
    id: String(i),
    page: 1,
    text: r.text,
    bounds: r.bounds,
    label: ["header", "footer", "footnote"][i],
  }));
  const result = readingColumns(
    [
      ...body,
      header,
      footer,
      footnote,
      { text: "12", bounds: { x: 0.48, y: 0.95, width: 0.04, height: 0.02 } },
    ],
    blocks,
  );
  expect(result).toHaveLength(1);
  expect(result[0].y).toBeCloseTo(0.2);
  expect(result[0].y + result[0].height).toBeCloseTo(0.885);
});

it("uses 150% for two columns and fills native single-column content using PDF CSS units", () => {
  expect(
    columnReadingScale(
      readingColumns([...rows(0.08), ...rows(0.55)]),
      600,
      600,
    ),
  ).toBe(1.5);
  const regions = readingColumns(
    rows(0.15).map((r) => ({ ...r, bounds: { ...r.bounds, width: 0.7 } })),
  );
  expect(
    columnReadingScale(regions, 600, 600) * 600 * (96 / 72) * 0.7,
  ).toBeCloseTo(568);
});
it("ignores repeated margin text before parsing and skips decoration-only pages", () => {
  const header = {
    text: "Repeated journal heading",
    bounds: { x: 0.1, y: 0.04, width: 0.8, height: 0.02 },
  };
  expect(readingColumns([header, ...rows(0.1)], [], [header])[0].y).toBeCloseTo(
    0.2,
  );
  const pageNumber = {
    text: "– 12 –",
    bounds: { x: 0.48, y: 0.95, width: 0.05, height: 0.02 },
  };
  expect(
    readingColumns(
      [pageNumber],
      [{ ...pageNumber, id: "number", page: 1, label: "number" }],
    ),
  ).toEqual([]);
  expect(readingColumns([pageNumber], [])).toEqual([
    { x: 0, y: 0, width: 1, height: 1 },
  ]);
});

it("preserves unknown scan pages and known full-page images", () => {
  expect(readingColumns([])).toEqual([{ x: 0, y: 0, width: 1, height: 1 }]);
  const image = {
    id: "image",
    page: 1,
    label: "image",
    text: "",
    image: "p1.png",
    bounds: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
  };
  expect(
    readingColumns(
      [{ text: "12", bounds: { x: 0.48, y: 0.95, width: 0.04, height: 0.02 } }],
      [image],
    ),
  ).toEqual([image.bounds]);
});

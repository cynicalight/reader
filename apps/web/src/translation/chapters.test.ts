import { expect, it } from "vitest";
import type { TOCItem } from "@reader/core";
import { chapterRange } from "./chapters";

const entry = (
  id: string,
  page: number,
  children: TOCItem[] = [],
): TOCItem => ({
  id,
  label: id,
  location: { type: "pdf", page },
  children,
});

it("spans from the chapter start to the page before the next chapter", () => {
  const toc = [entry("1", 5), entry("2", 20), entry("3", 41)];
  expect(chapterRange(toc, 25, 100)).toEqual({ fromPage: 20, toPage: 40 });
  expect(chapterRange(toc, 41, 100)).toEqual({ fromPage: 41, toPage: 100 });
  expect(chapterRange(toc, 2, 100)).toEqual({ fromPage: 1, toPage: 4 });
});

it("uses the children of a single title entry and ignores sections", () => {
  const toc = [
    entry("book", 1, [
      entry("0", 3, [entry("0-0", 4)]),
      entry("1", 30, [entry("1-0", 35)]),
    ]),
  ];
  expect(chapterRange(toc, 36, 80)).toEqual({ fromPage: 30, toPage: 80 });
});

it("keeps a chapter sharing its start page with the next one", () => {
  const toc = [entry("1", 10), entry("2", 10), entry("3", 12)];
  expect(chapterRange(toc, 10, 20)).toEqual({ fromPage: 10, toPage: 11 });
});

it("cuts a PDF without an outline into 20-page sections", () => {
  const pages = [1, 2, 3].map((page) => entry(`page-${page}`, page));
  expect(chapterRange(pages, 2, 3)).toEqual({ fromPage: 1, toPage: 3 });
  expect(chapterRange([], 25, 90)).toEqual({ fromPage: 21, toPage: 40 });
  expect(chapterRange([], 85, 90)).toEqual({ fromPage: 81, toPage: 90 });
});

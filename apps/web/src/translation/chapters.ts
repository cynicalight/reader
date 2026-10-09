import type { TOCItem } from "@reader/core";

export interface PageRange {
  fromPage: number;
  toPage: number;
}

/**
 * The outline chapter containing `page`, as an inclusive page range. A single
 * root entry (the book title) is skipped for its children. Without an outline
 * (the PDF adapter then lists every page) the book is cut into fixed sections.
 */
/** Pages per section of a book without an outline. */
export const sectionPages = 20;

export function chapterRange(
  toc: TOCItem[],
  page: number,
  pages: number,
): PageRange {
  const entries = toc.length === 1 ? toc[0].children : toc;
  const starts = [
    ...new Set(
      entries.flatMap((item) =>
        item.location.type === "pdf" && !item.id.startsWith("page-")
          ? [item.location.page]
          : [],
      ),
    ),
  ].sort((a, b) => a - b);
  const current = Math.min(Math.max(1, page), pages);
  if (!starts.length) {
    const fromPage =
      Math.floor((current - 1) / sectionPages) * sectionPages + 1;
    return { fromPage, toPage: Math.min(pages, fromPage + sectionPages - 1) };
  }
  const fromPage = starts.filter((start) => start <= current).at(-1) ?? 1;
  const next = starts.find((start) => start > current);
  return { fromPage, toPage: next ? Math.max(fromPage, next - 1) : pages };
}

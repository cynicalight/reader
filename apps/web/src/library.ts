import type { Document, DocumentCategory } from "@reader/core";
export const categoryLabels: Record<DocumentCategory, string> = {
  book: "书籍",
  article: "文章",
  paper: "论文",
};
export interface LibraryFilters {
  category: string;
  format: string;
  reading: string;
  tags: string[];
  sort: string;
}
export const initialFilters: LibraryFilters = {
  category: "all",
  format: "all",
  reading: "all",
  tags: [],
  sort: "recent",
};
export function libraryTags(documents: Document[]) {
  const tags = new Map<string, string>();
  for (const d of documents)
    for (const tag of d.tags)
      if (!tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag);
  return [...tags.values()].sort((a, b) => a.localeCompare(b, "zh"));
}
export function filterDocuments(
  documents: Document[],
  view: string,
  query: string,
  filters: LibraryFilters,
) {
  const text = query.trim().toLocaleLowerCase();
  return documents
    .filter((d) => {
      const tags = d.tags.map((tag) => tag.toLowerCase());
      return (
        (view !== "recent" || d.percentage > 0) &&
        (view !== "favorites" || d.favorite) &&
        (filters.category === "all" || d.category === filters.category) &&
        (filters.format === "all" || d.type === filters.format) &&
        (filters.reading === "all" ||
          (filters.reading === "unread"
            ? d.percentage === 0
            : filters.reading === "finished"
              ? d.percentage >= 1
              : d.percentage > 0 && d.percentage < 1)) &&
        filters.tags.every((tag) => tags.includes(tag.toLowerCase())) &&
        `${d.title} ${d.author} ${d.tags.join(" ")}`
          .toLocaleLowerCase()
          .includes(text)
      );
    })
    .sort((a, b) =>
      filters.sort === "title"
        ? a.title.localeCompare(b.title, "zh")
        : filters.sort === "added"
          ? b.createdAt.localeCompare(a.createdAt)
          : b.lastOpenedAt.localeCompare(a.lastOpenedAt),
    );
}

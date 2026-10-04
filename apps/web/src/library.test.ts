import { expect, it } from "vitest";
import type { Document } from "@reader/core";
import { filterDocuments, initialFilters, libraryTags } from "./library";
const makeDoc = (patch: Partial<Document>): Document => ({
  id: "1",
  type: "pdf",
  title: "Security",
  author: "Alice",
  size: 100,
  createdAt: "2026-10-01",
  lastOpenedAt: "2026-10-02",
  favorite: false,
  percentage: 0,
  category: "paper",
  categorySource: "ai",
  classificationStatus: "done",
  classificationError: "",
  tags: [],
  ...patch,
});
const documents = [
  makeDoc({
    id: "paper",
    favorite: true,
    tags: ["Web", "安全"],
    percentage: 0.5,
  }),
  makeDoc({ id: "article", category: "article", tags: ["web"], percentage: 1 }),
  makeDoc({
    id: "book",
    category: "book",
    type: "epub",
    tags: ["安全"],
    title: "A book",
  }),
];
it("combines category, format, reading, favorite, search and all selected tags", () => {
  const filters = {
    ...initialFilters,
    category: "paper",
    format: "pdf",
    reading: "reading",
    tags: ["web", "安全"],
  };
  expect(
    filterDocuments(documents, "favorites", " alice ", filters).map(
      (d) => d.id,
    ),
  ).toEqual(["paper"]);
  expect(
    filterDocuments(documents, "all", "", {
      ...initialFilters,
      tags: ["WEB", "安全"],
    }).map((d) => d.id),
  ).toEqual(["paper"]);
  expect(
    filterDocuments(documents, "all", "", { ...filters, format: "epub" }),
  ).toEqual([]);
});
it("supports unread/finished boundaries and title/tag search without mutating the library", () => {
  expect(
    filterDocuments(documents, "all", "", {
      ...initialFilters,
      reading: "unread",
    }).map((d) => d.id),
  ).toEqual(["book"]);
  expect(
    filterDocuments(documents, "recent", "", {
      ...initialFilters,
      reading: "finished",
    }).map((d) => d.id),
  ).toEqual(["article"]);
  expect(
    filterDocuments(documents, "all", "安全", initialFilters).map((d) => d.id),
  ).toEqual(["paper", "book"]);
  expect(
    filterDocuments(documents, "all", "", {
      ...initialFilters,
      sort: "title",
    })[0].id,
  ).toBe("book");
  expect(documents[0].id).toBe("paper");
  expect(
    libraryTags(documents).filter((tag) => tag.toLowerCase() === "web"),
  ).toEqual(["Web"]);
});

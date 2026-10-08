import type { Document } from "@reader/core";

/** A paper-library document for tests. */
export const paper = (patch: Partial<Document> = {}): Document => ({
  id: "p",
  type: "pdf",
  title: "Attention Is All You Need",
  author: "",
  size: 1,
  createdAt: "2026-10-01T00:00:00Z",
  lastOpenedAt: "2026-10-01T00:00:00Z",
  favorite: false,
  percentage: 0,
  category: "paper",
  categorySource: "manual",
  classificationStatus: "done",
  classificationError: "",
  library: "papers",
  metadata: {},
  readingStatus: "unread",
  noteCount: 0,
  highlightCount: 0,
  openQuestionCount: 0,
  related: [],
  tags: [],
  ...patch,
});

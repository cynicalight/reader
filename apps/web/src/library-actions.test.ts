import { beforeEach, expect, it, vi } from "vitest";
import type { Document } from "@reader/core";
import { api } from "@reader/api";
import {
  removeLibraryDocuments,
  toggleDocumentSelection,
} from "./library-actions";
import { useReaderStore, refreshLibrary } from "./store";
vi.mock("@reader/api", () => ({
  api: {
    trashDocument: vi.fn(),
    restoreDocument: vi.fn(),
    documents: vi.fn(),
    trash: vi.fn(),
  },
}));
const doc = (id: string) => ({ id }) as Document;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.trash).mockResolvedValue([]);
  useReaderStore.setState({
    documents: [doc("a"), doc("b"), doc("c")],
    active: null,
  });
});
it("selects ranges only inside current results and toggles one document", () => {
  expect([
    ...toggleDocumentSelection(new Set(["hidden"]), ["a", "b", "c"], "c", "a"),
  ]).toEqual(["a", "b", "c"]);
  expect([
    ...toggleDocumentSelection(new Set(["a", "b"]), ["a", "b"], "a", null),
  ]).toEqual(["b"]);
});
it("trashes acknowledged documents once and preserves failed documents for retry", async () => {
  vi.mocked(api.trashDocument).mockImplementation(async (id) => {
    if (id === "b") throw new Error("offline");
    return doc(id);
  });
  const result = await removeLibraryDocuments(["a", "a", "b"]);
  expect(result).toEqual({ deleted: ["a"], failed: ["b"] });
  expect(api.trashDocument).toHaveBeenCalledTimes(2);
  expect(useReaderStore.getState().documents.map((d) => d.id)).toEqual([
    "b",
    "c",
  ]);
});
it("does not resurrect a deleted document from an older poll", async () => {
  let finish!: (docs: Document[]) => void;
  vi.mocked(api.documents).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  vi.mocked(api.trashDocument).mockResolvedValue(doc("a"));
  const refreshing = refreshLibrary();
  await removeLibraryDocuments(["a"]);
  finish([doc("a"), doc("b"), doc("c")]);
  await refreshing;
  expect(useReaderStore.getState().documents.map((d) => d.id)).toEqual([
    "b",
    "c",
  ]);
});

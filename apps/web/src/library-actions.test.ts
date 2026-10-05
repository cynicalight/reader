import { beforeEach, expect, it, vi } from "vitest";
import type { Document } from "@reader/core";
import { api } from "@reader/api";
import {
  removeLibraryDocuments,
  toggleDocumentSelection,
} from "./library-actions";
import { useReaderStore, refreshLibrary } from "./store";
vi.mock("@reader/api", () => ({
  api: { removeDocument: vi.fn(), documents: vi.fn() },
}));
const doc = (id: string) => ({ id }) as Document;
beforeEach(() => {
  vi.clearAllMocks();
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
it("removes acknowledged documents once and preserves failed documents for retry", async () => {
  vi.mocked(api.removeDocument).mockImplementation(async (id) => {
    if (id === "b") throw new Error("offline");
  });
  const result = await removeLibraryDocuments(["a", "a", "b"]);
  expect(result).toEqual({ deleted: ["a"], failed: ["b"] });
  expect(api.removeDocument).toHaveBeenCalledTimes(2);
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
  vi.mocked(api.removeDocument).mockResolvedValue(undefined);
  const refreshing = refreshLibrary();
  await removeLibraryDocuments(["a"]);
  finish([doc("a"), doc("b"), doc("c")]);
  await refreshing;
  expect(useReaderStore.getState().documents.map((d) => d.id)).toEqual([
    "b",
    "c",
  ]);
});

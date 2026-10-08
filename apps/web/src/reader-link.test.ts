import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@reader/api";
import { openLinkTarget, useReaderStore } from "./store";
import { paper } from "./papers/fixtures";
vi.mock("@reader/api", () => ({
  api: {
    documents: vi.fn(async () => []),
    saveLibraryPreferences: vi.fn(async (value) => value),
  },
}));
const id = "0123456789abcdef0123456789abcdef";
beforeEach(() => {
  vi.clearAllMocks();
  useReaderStore.setState({
    documents: [],
    active: null,
    linkTarget: null,
    libraryPreferences: { mode: "books" },
  });
});
it("opens a linked paper in the paper library", async () => {
  const doc = paper({ id });
  vi.mocked(api.documents).mockResolvedValue([doc]);
  const target = { id, annotation: "fedcba9876543210fedcba9876543210" };
  expect(await openLinkTarget(target)).toBe(true);
  const state = useReaderStore.getState();
  expect(state.active).toEqual(doc);
  expect(state.linkTarget).toEqual(target);
  expect(state.libraryPreferences.mode).toBe("papers");
});
it("reports documents that are not in the library", async () => {
  vi.mocked(api.documents).mockResolvedValue([]);
  expect(await openLinkTarget({ id })).toBe(false);
  expect(useReaderStore.getState().active).toBeNull();
});

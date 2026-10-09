// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@reader/api";
import {
  libraryMode,
  loadLibraryPreferences,
  primaryLibraryMode,
  updateLibraryPreferences,
  useReaderStore,
} from "./store";
vi.mock("@reader/api", () => ({
  api: { saveLibraryPreferences: vi.fn(), libraryPreferences: vi.fn() },
}));
beforeEach(() => {
  vi.clearAllMocks();
  useReaderStore.setState({ libraryPreferences: {} });
});
it("defaults unknown preferences to the paper library", () => {
  expect(libraryMode({})).toBe("papers");
  expect(libraryMode({ mode: "papers" })).toBe("papers");
  expect(libraryMode({ mode: "other" as never })).toBe("papers");
  expect(libraryMode({ mode: "books" })).toBe("books");
});
it("applies preference changes at once and saves them in order", async () => {
  const saved: unknown[] = [];
  let release: (() => void) | undefined;
  vi.mocked(api.saveLibraryPreferences)
    .mockImplementationOnce(async (value) => {
      await new Promise<void>((resolve) => (release = resolve));
      saved.push(value);
      return value;
    })
    .mockImplementation(async (value) => {
      saved.push(value);
      return value;
    });
  const first = updateLibraryPreferences({ mode: "papers" });
  const second = updateLibraryPreferences({ mode: "books" });
  expect(useReaderStore.getState().libraryPreferences.mode).toBe("books");
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(saved).toEqual([]);
  release!();
  await Promise.all([first, second]);
  expect(saved).toEqual([{ mode: "papers" }, { mode: "books" }]);
});

it.each([undefined, "papers" as const, "books" as const])(
  "opens the primary library at startup (%s), preserving other preferences",
  async (primaryMode) => {
    const saved = {
      mode: "books" as const,
      primaryMode,
      papers: { autoLookup: false },
    };
    vi.mocked(api.libraryPreferences).mockResolvedValue(saved);
    await loadLibraryPreferences();
    expect(useReaderStore.getState().libraryPreferences).toEqual({
      ...saved,
      mode: primaryMode === "books" ? "books" : "papers",
    });
  },
);

it("keeps temporary mode changes separate from the primary library", async () => {
  useReaderStore.setState({
    libraryPreferences: {
      primaryMode: "books",
      mode: "books",
      papers: { autoLookup: false },
    },
  });
  await updateLibraryPreferences({ mode: "papers" });
  expect(libraryMode(useReaderStore.getState().libraryPreferences)).toBe(
    "papers",
  );
  expect(primaryLibraryMode(useReaderStore.getState().libraryPreferences)).toBe(
    "books",
  );
  expect(api.saveLibraryPreferences).toHaveBeenLastCalledWith({
    primaryMode: "books",
    mode: "papers",
    papers: { autoLookup: false },
  });
});

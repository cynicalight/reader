// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@reader/api";
import { LibraryModeSwitcher } from "./LibraryModeSwitcher";
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
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  useReaderStore.setState({ libraryPreferences: {} });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});
it("defaults unknown preferences to the paper library", () => {
  expect(libraryMode({})).toBe("papers");
  expect(libraryMode({ mode: "papers" })).toBe("papers");
  expect(libraryMode({ mode: "other" as never })).toBe("papers");
  expect(libraryMode({ mode: "books" })).toBe("books");
});
it("lists both libraries and reports the chosen one", async () => {
  const change = vi.fn();
  act(() =>
    root.render(<LibraryModeSwitcher mode="books" onChange={change} />),
  );
  const trigger = host.querySelector("button")!;
  expect(trigger.textContent).toContain("图书库");
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    trigger.click();
  });
  const items = [...document.querySelectorAll('[role="menuitem"]')];
  expect(items.map((item) => item.textContent)).toEqual([
    expect.stringContaining("文献库"),
    expect.stringContaining("图书库"),
  ]);
  await act(async () => (items[0] as HTMLElement).click());
  expect(change).toHaveBeenCalledWith("papers");
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

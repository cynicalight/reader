// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@reader/api";
import { LibraryModeSwitcher } from "./LibraryModeSwitcher";
import { libraryMode, updateLibraryPreferences, useReaderStore } from "./store";
vi.mock("@reader/api", () => ({
  api: { saveLibraryPreferences: vi.fn() },
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
it("defaults unknown preferences to the book library", () => {
  expect(libraryMode({})).toBe("books");
  expect(libraryMode({ mode: "papers" })).toBe("papers");
  expect(libraryMode({ mode: "other" as never })).toBe("books");
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
    expect.stringContaining("图书库"),
    expect.stringContaining("文献库"),
  ]);
  await act(async () => (items[1] as HTMLElement).click());
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

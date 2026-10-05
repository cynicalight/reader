// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { api } from "@reader/api";
import { TagBoards } from "./TagBoards";
vi.mock("@reader/api", () => ({
  api: {
    tagBoards: vi.fn(),
    updateTagBoard: vi.fn(),
    createTagBoard: vi.fn(),
    removeTagBoard: vi.fn(),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("./LibraryDocuments", () => ({ LibraryDocuments: () => null }));
const board = {
  id: "board",
  name: "Web Security",
  tags: ["web"],
  match: "all" as const,
};
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.clearAllMocks();
  vi.mocked(api.tagBoards).mockResolvedValue([board]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(
      <TagBoards
        documents={[]}
        query=""
        jobs={[]}
        processingError=""
        openDocument={() => {}}
        favorite={() => {}}
        onEdit={() => {}}
        onSettings={() => {}}
      />,
    ),
  );
}
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === text,
  )!;
it("keeps a board on deletion failure and removes it only after acknowledgement", async () => {
  await render();
  await act(async () =>
    (
      document.querySelector(
        '[aria-label="删除看板 Web Security"]',
      ) as HTMLButtonElement
    ).click(),
  );
  vi.mocked(api.removeTagBoard).mockRejectedValueOnce(Error("offline"));
  await act(async () => button("删除看板").click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(host.querySelector(".tag-board-card")).not.toBeNull();
  vi.mocked(api.removeTagBoard).mockResolvedValue(undefined);
  await act(async () => button("删除看板").click());
  expect(host.querySelector(".tag-board-card")).toBeNull();
});
it("retains edited board values on save failure for retry", async () => {
  await render();
  await act(async () =>
    (
      document.querySelector(
        '[aria-label="编辑看板 Web Security"]',
      ) as HTMLButtonElement
    ).click(),
  );
  const name = document.querySelector<HTMLInputElement>("#board-name")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(name, "Renamed");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  vi.mocked(api.updateTagBoard).mockRejectedValueOnce(Error("offline"));
  await act(async () => button("保存").click());
  expect(name.value).toBe("Renamed");
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  vi.mocked(api.updateTagBoard).mockResolvedValue({
    ...board,
    name: "Renamed",
  });
  await act(async () => button("保存").click());
  expect(api.updateTagBoard).toHaveBeenLastCalledWith("board", {
    name: "Renamed",
    tags: ["web"],
    match: "all",
  });
  expect(host.textContent).toContain("Renamed");
});
it("offers retry after failing to load saved boards", async () => {
  vi.mocked(api.tagBoards).mockRejectedValueOnce(Error("offline"));
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "offline",
  );
  await act(async () => button("重新加载看板").click());
  expect(host.querySelector(".tag-board-card")?.textContent).toContain(
    "Web Security",
  );
});

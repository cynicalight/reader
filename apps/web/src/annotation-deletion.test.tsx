// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { api } from "@reader/api";
import { toast } from "sonner";
import { useAnnotationDeletion } from "./useAnnotationDeletion";

vi.mock("@reader/api", () => ({ api: { removeAnnotation: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
let root: Root;
let host: HTMLDivElement;
let actions: ReturnType<typeof useAnnotationDeletion>;
const deleted = vi.fn();
function Harness({ documentId }: { documentId: string }) {
  actions = useAnnotationDeletion(documentId, deleted);
  return null;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  host = document.createElement("div");
  root = createRoot(host);
  await act(async () => root.render(<Harness documentId="first" />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
it("waits for server acknowledgement and ignores duplicate deletion attempts", async () => {
  let finish!: () => void;
  vi.mocked(api.removeAnnotation).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let result!: Promise<void>;
  act(() => {
    result = actions.remove("note");
    void actions.remove("note");
  });
  expect(api.removeAnnotation).toHaveBeenCalledExactlyOnceWith("first", "note");
  expect(actions.deleting.has("note")).toBe(true);
  expect(deleted).not.toHaveBeenCalled();
  await act(async () => {
    finish();
    await result;
  });
  expect(deleted).toHaveBeenCalledExactlyOnceWith("note");
  expect(actions.deleting.size).toBe(0);
});
it("preserves the record on failure and permits retry", async () => {
  vi.mocked(api.removeAnnotation).mockRejectedValueOnce(new Error("删除失败"));
  await act(async () => actions.remove("note"));
  expect(deleted).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith("删除失败");
  expect(actions.deleting.size).toBe(0);
  vi.mocked(api.removeAnnotation).mockResolvedValueOnce(undefined);
  await act(async () => actions.remove("note"));
  expect(deleted).toHaveBeenCalledExactlyOnceWith("note");
});
it("ignores stale deletion completion after changing documents", async () => {
  let finish!: () => void;
  vi.mocked(api.removeAnnotation).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let result!: Promise<void>;
  act(() => {
    result = actions.remove("note");
  });
  await act(async () => root.render(<Harness documentId="second" />));
  await act(async () => {
    finish();
    await result;
  });
  expect(deleted).not.toHaveBeenCalled();
  expect(actions.deleting.size).toBe(0);
});

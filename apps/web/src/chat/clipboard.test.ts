// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { copyText } from "./clipboard";
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("uses the desktop bridge when browser clipboard permission is denied", async () => {
  const writeText = vi
    .fn()
    .mockRejectedValue(new Error("Write permission denied"));
  const writeClipboardText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  vi.stubGlobal("window", { readerDesktop: { writeClipboardText } });
  expect(await copyText("回答原文")).toBe(true);
  expect(writeClipboardText).toHaveBeenCalledWith("回答原文");
  expect(writeText).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});
it("uses the browser clipboard outside Electron", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await copyText("https://example.com");
  expect(writeText).toHaveBeenCalledWith("https://example.com");
});
it("reports a clipboard write failure", async () => {
  vi.stubGlobal("navigator", {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  expect(await copyText("回答原文", "原文已复制")).toBe(false);
  expect(toast.error).toHaveBeenCalledOnce();
  expect(toast.success).not.toHaveBeenCalled();
});
it("confirms successful copies and writes again when the same passage is clicked again", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await copyText("原文", "原文已复制");
  await copyText("原文", "原文已复制");
  expect(writeText).toHaveBeenCalledTimes(2);
  expect(toast.success).toHaveBeenLastCalledWith("原文已复制", {
    id: "reader-clipboard",
  });
});

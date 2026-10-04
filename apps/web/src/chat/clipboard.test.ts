// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { copyText } from "./clipboard";
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
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
  await copyText("回答原文");
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
  await copyText("回答原文");
  expect(toast.error).toHaveBeenCalledOnce();
});

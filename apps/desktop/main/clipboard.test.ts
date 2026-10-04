import { afterEach, expect, it, vi } from "vitest";
import { clipboard, type IpcMainInvokeEvent, type WebContents } from "electron";
import { writeClipboardText } from "./clipboard";
vi.mock("electron", () => ({ clipboard: { writeText: vi.fn() } }));
afterEach(() => vi.clearAllMocks());
function sender(url = "http://127.0.0.1:1234/") {
  const frame = { url };
  const contents = { mainFrame: frame } as WebContents;
  const event = { sender: contents, senderFrame: frame } as IpcMainInvokeEvent;
  return { contents, event };
}
it("writes exact text from the app main frame", () => {
  const { contents, event } = sender();
  writeClipboardText(
    event,
    "回答\n**原文**",
    contents,
    "http://127.0.0.1:1234",
  );
  expect(clipboard.writeText).toHaveBeenCalledWith("回答\n**原文**");
});
it.each([
  "other-window",
  "child-frame",
  "external-origin",
  "missing-window",
  "non-text",
])("rejects %s clipboard requests", (scenario) => {
  const { contents, event } = sender(
    scenario === "external-origin" ? "https://example.com" : undefined,
  );
  const request = {
    ...event,
    sender: scenario === "other-window" ? ({} as WebContents) : event.sender,
    senderFrame:
      scenario === "child-frame"
        ? ({ url: "http://127.0.0.1:1234/" } as NonNullable<
            IpcMainInvokeEvent["senderFrame"]
          >)
        : event.senderFrame,
  };
  expect(() =>
    writeClipboardText(
      request,
      scenario === "non-text" ? {} : "text",
      scenario === "missing-window" ? undefined : contents,
      "http://127.0.0.1:1234",
    ),
  ).toThrow();
  expect(clipboard.writeText).not.toHaveBeenCalled();
});

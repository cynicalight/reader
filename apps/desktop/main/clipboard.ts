import { clipboard, type IpcMainInvokeEvent, type WebContents } from "electron";

export function writeClipboardText(
  event: IpcMainInvokeEvent,
  text: unknown,
  contents: WebContents | undefined,
  appURL: string,
) {
  if (
    !contents ||
    event.sender !== contents ||
    !event.senderFrame ||
    event.senderFrame !== contents.mainFrame ||
    new URL(event.senderFrame.url).origin !== new URL(appURL).origin
  )
    throw new Error("Invalid sender");
  if (typeof text !== "string") throw new Error("Invalid clipboard text");
  clipboard.writeText(text);
}

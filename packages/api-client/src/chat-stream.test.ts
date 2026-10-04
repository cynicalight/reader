import { describe, expect, it } from "vitest";
import { consumeChatStream, type ChatStreamEvent } from "./chat-stream";
const encode = (text: string) => new TextEncoder().encode(text);
function stream(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
}
const fixture =
  ': comment\r\nevent:status\r\ndata: {"status":"reading"}\r\n\r\nevent: delta\r\ndata: {"text":\r\ndata: "中文 👩🏽‍💻 é\\n"}\r\n\r\nevent:done\r\ndata:{"ok":true}\r\n\r\n';
describe("frozen SSE consumption", () => {
  it("preserves UTF8 across every byte boundary, CRLF and multiline data", async () => {
    const bytes = encode(fixture);
    const seen: ChatStreamEvent[] = [];
    await consumeChatStream(
      stream(Array.from(bytes, (byte) => Uint8Array.of(byte))),
      new AbortController().signal,
      (event) => seen.push(event),
    );
    expect(seen).toEqual([
      { event: "status", data: { status: "reading" } },
      { event: "delta", data: { text: "中文 👩🏽‍💻 é\n" } },
      { event: "done", data: { ok: true } },
    ]);
  });
  it("ignores unknown events and anything after terminal, even in the same chunk", async () => {
    const events: ChatStreamEvent[] = [];
    await consumeChatStream(
      stream([
        encode(
          'event: mystery\ndata: bad\n\nevent: done\ndata:{"ok":true}\n\nevent:delta\ndata:{"text":"late"}\n\nevent:done\ndata:{"ok":true}\n\n',
        ),
      ]),
      new AbortController().signal,
      (event) => events.push(event),
    );
    expect(events).toEqual([{ event: "done", data: { ok: true } }]);
  });
  it.each([
    'event:delta\ndata: {"text":7}\n\n',
    "event:done\ndata: invalid\n\n",
    'event:done\ndata:{"ok":false}\n\n',
    'event:delta\ndata:{"text":"partial"}\n\n',
    'event:done\ndata:{"ok":true}',
  ])("rejects invalid or unterminated completion %s", async (text) => {
    await expect(
      consumeChatStream(
        stream([encode(text)]),
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow();
  });
  it("retains delivered partial before provider error and never delivers trailing done", async () => {
    const events: ChatStreamEvent[] = [];
    await expect(
      consumeChatStream(
        stream([
          encode(
            'event:delta\ndata:{"text":"partial"}\n\nevent:error\ndata:{"error":"failed"}\n\nevent:done\ndata:{"ok":true}\n\n',
          ),
        ]),
        new AbortController().signal,
        (event) => events.push(event),
      ),
    ).rejects.toThrow("failed");
    expect(events.map((event) => event.event)).toEqual(["delta", "error"]);
  });
  it("abort releases a pending read", async () => {
    let cancelled = false;
    const controller = new AbortController();
    const pending = consumeChatStream(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      controller.signal,
      () => {},
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toBe(true);
  });
});

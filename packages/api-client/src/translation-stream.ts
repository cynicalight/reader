import type { TranslationBlock } from "@reader/core";

export type TranslationEvent =
  | { event: "snapshot"; data: TranslationBlock[] }
  | { event: "translation"; data: TranslationBlock };
function isBlock(value: unknown): value is TranslationBlock {
  if (!value || typeof value !== "object") return false;
  const b = value as TranslationBlock;
  return (
    typeof b.blockId === "string" &&
    typeof b.sourceHash === "string" &&
    ["pending", "running", "complete", "failed"].includes(b.status) &&
    Array.isArray(b.sentences) &&
    b.sentences.every(
      (s) => s && typeof s.source === "string" && typeof s.target === "string",
    )
  );
}
// Dispatch every complete SSE frame while the connection is still open.
export async function consumeTranslationStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: TranslationEvent) => void,
) {
  const reader = body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) throw new Error("译文连接中断，正在重新连接…");
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let event = "",
          data = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) data += line.slice(5).trimStart();
        }
        if (!event) continue;
        const value: unknown = JSON.parse(data);
        if (event === "error")
          throw new Error("译文订阅不可用，请重新打开文档");
        if (
          event === "snapshot" &&
          Array.isArray(value) &&
          value.every(isBlock)
        )
          onEvent({ event, data: value });
        else if (event === "translation" && isBlock(value))
          onEvent({ event, data: value });
        else throw new Error("译文事件格式无效");
      }
      if (buffer.length > 64 * 1024 * 1024)
        throw new Error("译文事件超出大小限制");
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

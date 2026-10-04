import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@reader/core";
import type { ChatStreamEvent } from "@reader/api";
import {
  ChatSession,
  type ChatInput,
  type ChatTransport,
} from "./chat-session";
const input: ChatInput = {
  provider: "codex",
  prompt: "question",
  context: "",
  references: [],
  attachments: [],
};
const message = (
  id: string,
  role: "user" | "assistant",
  content: string,
): Message => ({
  id,
  role,
  content,
  documentId: "doc",
  context: "",
  createdAt: "2026-10-05",
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(
  messages = vi.fn<ChatTransport["messages"]>().mockResolvedValue([]),
) {
  const wait = deferred<void>();
  let emit!: (event: ChatStreamEvent) => void;
  let signal!: AbortSignal;
  const session = new ChatSession("doc", {
    messages,
    stream: async (_, __, abort, callback) => {
      signal = abort;
      emit = callback;
      await wait.promise;
    },
  });
  return {
    session,
    messages,
    wait,
    emit: (event: ChatStreamEvent) => emit(event),
    signal: () => signal,
  };
}
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) =>
    setTimeout(callback, 0),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
});
afterEach(() => vi.unstubAllGlobals());
describe("chat request lifecycle", () => {
  it("retains raw text when done is followed by messages failure; retry replaces, never appends", async () => {
    const h = setup();
    await h.session.load();
    h.messages.mockRejectedValueOnce(new Error("offline"));
    const send = h.session.send(input);
    const beforeDelta = h.session.getSnapshot();
    h.emit({ event: "delta", data: { text: "**answer" } });
    expect(beforeDelta.pending?.content).toBe("");
    h.emit({ event: "done", data: { ok: true } });
    h.emit({ event: "delta", data: { text: "late" } });
    h.wait.resolve();
    await send;
    expect(h.session.getSnapshot().pending).toMatchObject({
      content: "**answer",
      phase: "syncing",
      notice: expect.stringContaining("已保存"),
    });
    h.messages.mockResolvedValue([
      message("u", "user", "question"),
      message("a", "assistant", "**answer**"),
    ]);
    await h.session.retry();
    expect(h.session.getSnapshot().pending).toMatchObject({
      content: "**answer**",
      phase: "saved",
      savedId: "a",
    });
  });
  it("provider error preserves partial and rejects late terminal/delta", async () => {
    const h = setup();
    await h.session.load();
    const send = h.session.send(input);
    h.emit({ event: "delta", data: { text: "partial" } });
    h.emit({ event: "error", data: { error: "failed" } });
    h.emit({ event: "done", data: { ok: true } });
    h.wait.reject(new Error("failed"));
    await send;
    expect(h.session.getSnapshot().pending).toMatchObject({
      content: "partial",
      phase: "incomplete",
    });
  });
  it("cancel aborts immediately, preserves tail, and reconciles save race", async () => {
    const h = setup();
    await h.session.load();
    const send = h.session.send(input);
    h.emit({ event: "delta", data: { text: "tail" } });
    h.session.cancel();
    expect(h.signal().aborted).toBe(true);
    expect(h.session.getSnapshot().pending?.phase).toBe("cancelled");
    h.emit({ event: "delta", data: { text: "late" } });
    h.messages.mockResolvedValue([
      message("u", "user", "question"),
      message("a", "assistant", "tail"),
    ]);
    h.wait.reject(new Error("aborted"));
    await send;
    expect(h.session.getSnapshot().pending).toMatchObject({
      content: "tail",
      savedId: "a",
    });
  });
  it("unmount blocks callbacks, finally and stale message queries", async () => {
    const h = setup();
    await h.session.load();
    const query = deferred<Message[]>();
    h.messages.mockReturnValueOnce(query.promise);
    const send = h.session.send(input);
    h.emit({ event: "done", data: { ok: true } });
    h.wait.resolve();
    await Promise.resolve();
    await Promise.resolve();
    h.session.dispose();
    const previous = h.session.getSnapshot();
    h.emit({ event: "delta", data: { text: "late" } });
    query.resolve([message("a", "assistant", "old")]);
    await send;
    expect(h.session.getSnapshot()).toBe(previous);
  });
  it("does not identify an old equal-content answer as this request", async () => {
    const h = setup(
      vi
        .fn<ChatTransport["messages"]>()
        .mockResolvedValue([message("old", "assistant", "answer")]),
    );
    await h.session.load();
    const send = h.session.send(input);
    h.emit({ event: "delta", data: { text: "answer" } });
    h.emit({ event: "done", data: { ok: true } });
    h.wait.resolve();
    await send;
    expect(h.session.getSnapshot().pending?.savedId).toBeUndefined();
    expect(h.session.getSnapshot().pending?.phase).toBe("syncing");
  });
  it("ambiguous concurrent records stay pending, and EOF never implies saved", async () => {
    const h = setup();
    await h.session.load();
    const send = h.session.send(input);
    h.emit({ event: "delta", data: { text: "answer" } });
    h.messages.mockResolvedValue([
      message("u", "user", "question"),
      message("a", "assistant", "answer"),
      message("b", "assistant", "answer"),
    ]);
    h.wait.resolve();
    await send;
    expect(h.session.getSnapshot().pending).toMatchObject({
      phase: "unconfirmed",
      content: "answer",
    });
  });
  it("serializes requests synchronously and preserves unsaved partial on next request", async () => {
    const h = setup();
    await h.session.load();
    const first = h.session.send(input);
    await h.session.send(input);
    h.emit({ event: "delta", data: { text: "partial" } });
    h.wait.resolve();
    await first;
    await h.session.send(input);
    expect(h.session.getSnapshot().archived[0].content).toBe("partial");
  });
});

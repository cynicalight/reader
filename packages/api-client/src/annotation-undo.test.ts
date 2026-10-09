import { afterEach, expect, it, vi } from "vitest";
import { api, configureAPI } from "./index";
import type { Annotation } from "@reader/core";
afterEach(() => vi.unstubAllGlobals());
it("queues undo after writes and keeps a stable window session", async () => {
  configureAPI("test");
  let finish!: (response: Response) => void;
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ undone: true, annotations: [] }), {
        status: 200,
      }),
    );
  vi.stubGlobal("fetch", fetch);
  const saved = api.annotate("doc", {
    kind: "highlight",
    location: { type: "pdf", page: 1 },
    quote: "text",
    note: "",
    color: "#e6b94c",
  });
  const undo = api.undoAnnotation("doc");
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  finish(
    new Response(JSON.stringify({ id: "a" } as Annotation), { status: 201 }),
  );
  await saved;
  await undo;
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][0]).toBe("/api/documents/doc/annotations/undo");
  const first = fetch.mock.calls[0][1].headers["X-Reader-Undo-Session"];
  expect(first).toBeTruthy();
  expect(fetch.mock.calls[1][1].headers["X-Reader-Undo-Session"]).toBe(first);
});
it("a failed save does not block the next undo", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "failed" }), { status: 500 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ undone: false, annotations: [] }), {
        status: 200,
      }),
    );
  vi.stubGlobal("fetch", fetch);
  await expect(api.removeAnnotation("doc", "a")).rejects.toThrow("failed");
  await expect(api.undoAnnotation("doc")).resolves.toMatchObject({
    undone: false,
  });
});

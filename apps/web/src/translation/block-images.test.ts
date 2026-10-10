import { afterEach, expect, it, vi } from "vitest";
import { blockImageCache } from "./block-images";

afterEach(() => vi.unstubAllGlobals());

it("reuses a block render unless a wider one is needed", async () => {
  let next = 0;
  const revoke = vi.fn();
  vi.stubGlobal("URL", {
    createObjectURL: () => `blob:${++next}`,
    revokeObjectURL: revoke,
  });
  const render = vi.fn(async () => new Blob());
  const cache = blockImageCache(render);
  expect(await cache.url("p1-b1", 600)).toBe("blob:1");
  expect(await cache.url("p1-b1", 700)).toBe("blob:1");
  expect(render).toHaveBeenCalledWith("p1-b1", expect.any(AbortSignal), 768);
  expect(await cache.url("p1-b1", 1200)).toBe("blob:2");
  cache.dispose();
  expect(revoke).toHaveBeenCalledWith("blob:1");
  expect(revoke).toHaveBeenCalledWith("blob:2");
});

it("retries a block whose render failed", async () => {
  const render = vi
    .fn()
    .mockRejectedValueOnce(new Error("busy"))
    .mockResolvedValue(new Blob());
  vi.stubGlobal("URL", { createObjectURL: () => "blob:ok" });
  const cache = blockImageCache(render);
  await expect(cache.url("p1-b1", 600)).rejects.toThrow("busy");
  expect(await cache.url("p1-b1", 600)).toBe("blob:ok");
});

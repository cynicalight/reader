import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { model, resolveModel } from "./model";
const roots: string[] = [];
async function temporary() {
  const root = await mkdtemp(join(tmpdir(), "reader-model-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
it("rejects a truncated download without publishing a cache file or leaving a partial file", async () => {
  const root = await temporary();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
  );
  await expect(resolveModel(root)).rejects.toThrow("版面模型校验失败");
  expect(await readdir(root)).toEqual([]);
});
it("does not replace an existing model on failed integrity validation", async () => {
  const root = await temporary(),
    path = join(root, `${model.name}-${model.revision}.onnx`);
  await writeFile(path, "corrupt");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(resolveModel(root)).rejects.toThrow("版面模型校验失败");
  expect(fetch).not.toHaveBeenCalled();
  expect(await readFile(path, "utf8")).toBe("corrupt");
});
it("does not silently download when an explicit model path is missing", async () => {
  const root = await temporary();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    resolveModel(root, join(root, "missing.onnx")),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

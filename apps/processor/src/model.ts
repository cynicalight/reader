import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
// Byte-identical mirror of stefanj0/PP-DocLayoutV3-FP16-ONNX@ca51555, an FP16
// export of PaddlePaddle/PP-DocLayoutV3_safetensors without the mask head.
export const model = {
  name: "PP-DocLayoutV3-FP16",
  revision: "58dfa00ba1135e027817cbd5802f1f0df62aa5c0",
  sha256: "8bb693ed3b5dcc1cf926b15d89dfe6abf62bc11cdd0afd33c8ffe039db6f8209",
  bytes: 67372587,
  output: "det",
};
// Earlier pinned models; their cache files are dropped once this one is ready.
const superseded = [
  "PP-DocLayoutV3-46bbdf188bb0a772c08aed74882ce7e51a8f1ea6.onnx",
];
export async function digest(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export async function resolveModel(cache: string, explicit?: string) {
  const path = await fetchModel(cache, explicit);
  if (!explicit)
    await Promise.all(
      superseded.map((name) => rm(join(cache, name), { force: true })),
    );
  return path;
}
async function fetchModel(cache: string, explicit?: string) {
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const target =
    explicit ?? join(cache, `${model.name}-${model.revision}.onnx`);
  try {
    if ((await digest(target)) === model.sha256) return target;
    throw new Error("版面模型校验失败");
  } catch (error) {
    if (explicit || (error as NodeJS.ErrnoException).code !== "ENOENT")
      throw error;
  }
  process.stdout.write(
    JSON.stringify({ event: "model-download", bytes: model.bytes }) + "\n",
  );
  const response = await fetch(
    `https://huggingface.co/bu44er/PP-DocLayoutV3-FP16-ONNX/resolve/${model.revision}/PP-DocLayoutV3-fp16.onnx`,
    { signal: AbortSignal.timeout(300_000) },
  );
  if (!response.ok || !response.body)
    throw new Error(`模型下载失败：HTTP ${response.status}`);
  const part = `${target}.${process.pid}.part`;
  const file = await open(part, "wx", 0o600);
  let bytes = 0;
  let lastReport = 0;
  const hash = createHash("sha256");
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      bytes += chunk.length;
      if (bytes > model.bytes) throw new Error("模型文件过大");
      hash.update(chunk);
      if (Date.now() - lastReport > 500) {
        process.stdout.write(
          JSON.stringify({
            event: "model-progress",
            downloaded: bytes,
            bytes: model.bytes,
          }) + "\n",
        );
        lastReport = Date.now();
      }
      // FileHandle.write may write fewer bytes than requested.
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await file.write(
          chunk,
          offset,
          chunk.length - offset,
        );
        if (!bytesWritten) throw new Error("模型保存失败");
        offset += bytesWritten;
      }
    }
    if (bytes !== model.bytes || hash.digest("hex") !== model.sha256)
      throw new Error("版面模型校验失败");
    await file.sync();
    await file.close();
    await rename(part, target);
    return target;
  } finally {
    await reader.cancel();
    await file.close();
    await rm(part, { force: true });
  }
}

// Runs inside the packaged processor directory with Electron's embedded Node.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import * as ort from "onnxruntime-node";

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
assert.equal(
  require("@napi-rs/canvas/package.json").version,
  createRequire(join(pdfjsRoot, "package.json"))("@napi-rs/canvas/package.json")
    .version,
);
const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
const base = dirname(fileURLToPath(import.meta.url));
const task = getDocument({
  data: new Uint8Array(
    await readFile(join(base, "../web/samples/reading-notes.pdf")),
  ),
  standardFontDataUrl: join(pdfjsRoot, "standard_fonts/"),
  cMapUrl: join(pdfjsRoot, "cmaps/"),
  cMapPacked: true,
  useSystemFonts: false,
});
const pdf = await task.promise;
assert.ok(pdf.numPages > 0);
const page = await pdf.getPage(1);
const viewport = page.getViewport({ scale: 0.5 });
const canvas = createCanvas(
  Math.ceil(viewport.width),
  Math.ceil(viewport.height),
);
await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
assert.ok(canvas.toBuffer("image/png").length > 100);
await task.destroy();
// Self-contained Identity model: float32[1] -> float32[1], opset 13, IR 8.
const model = Buffer.from(
  "CAg6VAoZCgVpbnB1dBIGb3V0cHV0IghJZGVudGl0eRIMcmVhZGVyLXNtb2tlWhMKBWlucHV0EgoKCAgBEgQKAggBYhQKBm91dHB1dBIKCggIARIECgIIAUICEA0=",
  "base64",
);
const session = await ort.InferenceSession.create(model, {
  executionProviders: ["cpu"],
});
try {
  const result = await session.run({
    input: new ort.Tensor("float32", Float32Array.of(42), [1]),
  });
  assert.equal(result.output.data[0], 42);
} finally {
  await session.release();
}
console.log("Packaged PDF.js rendering, canvas and ONNX inference passed.");

import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import * as ort from "onnxruntime-node";
import { readFile, writeFile, mkdir, rename, readdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import {
  assignText,
  decodeRegions,
  readingRegions,
  isAsset,
  type Region,
} from "./layout";
import { extractTextSpans } from "./text";
import { digest, model, resolveModel } from "./model";
import { selectProcessingPages } from "./page-selection";

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
const require = createRequire(import.meta.url);
const assets = dirname(require.resolve("pdfjs-dist/package.json"));
const pdfRequire = createRequire(require.resolve("pdfjs-dist/package.json"));
if (
  pdfRequire.resolve("@napi-rs/canvas") !== require.resolve("@napi-rs/canvas")
)
  throw new Error("PDF.js 和处理器的原生 Canvas 版本必须一致，请重新安装依赖");
const { values } = parseArgs({
  options: {
    input: { type: "string" },
    output: { type: "string" },
    "model-cache": { type: "string" },
    model: { type: "string" },
    pages: { type: "string" },
    debug: { type: "boolean", default: false },
  },
});
if (!values.input || !values.output)
  throw new Error(
    "Usage: --input PDF --output DIRECTORY [--model FILE] [--model-cache DIRECTORY] [--debug]",
  );
const input = resolve(values.input),
  output = resolve(values.output);
await mkdir(output, { recursive: true, mode: 0o700 });
if ((await readdir(output)).length)
  throw new Error("输出目录必须为空，避免覆盖已有解析稿或用户修订");
await mkdir(join(output, "assets"), { recursive: true, mode: 0o700 });
const modelPath = await resolveModel(
  resolve(values["model-cache"] ?? join(output, "..", "models")),
  values.model,
);
const session = await ort.InferenceSession.create(modelPath, {
  intraOpNumThreads: 2,
  interOpNumThreads: 1,
  executionProviders: ["cpu"],
});
const file = await readFile(input);
if (file.byteLength > 100 * 1024 * 1024) throw new Error("PDF 超过 100 MB");
const loading = getDocument({
  data: new Uint8Array(file),
  useSystemFonts: true,
  cMapUrl: join(assets, "cmaps") + "/",
  cMapPacked: true,
  standardFontDataUrl: join(assets, "standard_fonts") + "/",
  wasmUrl: join(assets, "wasm") + "/",
});
interface Block extends Region {
  id: string;
  page: number;
  text: string;
  image?: string;
  caption?: string;
}
const blocks: Block[] = [];
const warnings: string[] = [];
const incompletePages: number[] = [];
const sections: string[] = [];
const timings: {
  page: number;
  milliseconds: number;
  regions: number;
  assets: number;
}[] = [];
const start = performance.now();
try {
  const pdf = await loading.promise;
  const processedPages = selectProcessingPages(pdf.numPages, values.pages);
  const metadata = await pdf.getMetadata();
  for (const number of processedPages) {
    const pageStart = performance.now();
    const page = await pdf.getPage(number);
    const original = page.getViewport({ scale: 1 });
    const scale = Math.min(
      2,
      Math.sqrt(4_000_000 / (original.width * original.height)),
    );
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    const context = canvas.getContext("2d");
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      background: "white",
    }).promise;
    const thumbnail = createCanvas(800, 800),
      thumbContext = thumbnail.getContext("2d");
    thumbContext.drawImage(canvas, 0, 0, 800, 800);
    const rgba = thumbContext.getImageData(0, 0, 800, 800).data;
    const rgb = new Float32Array(3 * 800 * 800);
    for (let i = 0; i < 800 * 800; i++) {
      rgb[i] = rgba[i * 4] / 255;
      rgb[i + 800 * 800] = rgba[i * 4 + 1] / 255;
      rgb[i + 2 * 800 * 800] = rgba[i * 4 + 2] / 255;
    }
    const result = await session.run(
      {
        image: new ort.Tensor("float32", rgb, [1, 3, 800, 800]),
        im_shape: new ort.Tensor(
          "float32",
          new Float32Array([800, 800]),
          [1, 2],
        ),
        scale_factor: new ort.Tensor(
          "float32",
          new Float32Array([800 / canvas.height, 800 / canvas.width]),
          [1, 2],
        ),
      },
      ["fetch_name_0"],
    );
    const regions = decodeRegions(
      result.fetch_name_0.data as Float32Array,
      canvas.width,
      canvas.height,
    );
    for (const tensor of Object.values(result)) tensor.dispose();
    const spans = await extractTextSpans(page, scale);
    if (!spans.length) incompletePages.push(number);
    if (!spans.length)
      warnings.push(`第 ${number} 页无可提取文字；尚未接入 OCR，正文不完整。`);
    const composed = readingRegions(regions, spans);
    const assigned = assignText(composed, spans);
    const pageBlocks: Block[] = composed.map((region, i) => ({
      ...region,
      id: `p${number}-b${i + 1}`,
      page: number,
      text: assigned.texts[i],
    }));
    for (const block of pageBlocks) {
      if (!isAsset(block.label)) continue;
      const b = block.bounds;
      const x = Math.max(0, Math.floor(b.x * canvas.width) - 3),
        y = Math.max(0, Math.floor(b.y * canvas.height) - 3);
      const width = Math.min(
        canvas.width - x,
        Math.ceil(b.width * canvas.width) + 6,
      );
      const height = Math.min(
        canvas.height - y,
        Math.ceil(b.height * canvas.height) + 6,
      );
      const crop = createCanvas(width, height);
      crop
        .getContext("2d")
        .drawImage(canvas, x, y, width, height, 0, 0, width, height);
      block.image = `assets/${block.id}.png`;
      await writeFile(join(output, block.image), crop.toBuffer("image/png"), {
        mode: 0o600,
      });
    }
    blocks.push(...pageBlocks);
    sections.push(`<!-- page:${number} -->`);
    for (const block of pageBlocks) {
      if (block.image)
        sections.push(
          `<!-- block:${block.id} type:${block.label} -->\n[${block.label}: ${block.id}](${block.image})\n\n<!-- transcript:transcripts/${block.id}.md -->`,
        );
      else if (block.text)
        sections.push(
          `<!-- block:${block.id} -->\n${block.label === "doc_title" ? "# " : block.label === "paragraph_title" ? "## " : ""}${block.text}`,
        );
    }
    if (assigned.unmatched) {
      sections.push(
        `<!-- unmatched-text page:${number} -->\n${assigned.unmatched}`,
      );
      warnings.push(`第 ${number} 页有未归入版面块的文字，已保留。`);
    }
    if (values.debug) {
      await writeFile(
        join(output, `page-${number}.png`),
        canvas.toBuffer("image/png"),
        { mode: 0o600 },
      );
      context.lineWidth = 2;
      context.font = "16px sans-serif";
      for (const block of pageBlocks) {
        const b = block.bounds;
        context.strokeStyle = isAsset(block.label) ? "#e11d48" : "#2563eb";
        context.strokeRect(
          b.x * canvas.width,
          b.y * canvas.height,
          b.width * canvas.width,
          b.height * canvas.height,
        );
        context.fillStyle = context.strokeStyle;
        context.fillText(
          `${block.id} ${block.label} ${block.confidence.toFixed(2)}`,
          b.x * canvas.width,
          Math.max(16, b.y * canvas.height),
        );
      }
      await writeFile(
        join(output, `layout-${number}.png`),
        canvas.toBuffer("image/png"),
        { mode: 0o600 },
      );
    }
    timings.push({
      page: number,
      milliseconds: Math.round(performance.now() - pageStart),
      regions: regions.length,
      assets: pageBlocks.filter((b) => b.image).length,
    });
    process.stdout.write(
      JSON.stringify({
        event: "page",
        ...timings.at(-1),
        total: pdf.numPages,
      }) + "\n",
    );
    page.cleanup();
  }
  const manifest = {
    schemaVersion: 1,
    textExtractionVersion: 2,
    inputSHA256: await digest(input),
    model,
    pages: pdf.numPages,
    processedPages,
    metadata: metadata.info,
    blocks,
    warnings,
    incompletePages,
    timings,
    elapsedMilliseconds: Math.round(performance.now() - start),
    peakRSSBytes: process.resourceUsage().maxRSS * 1024,
  };
  await writeFile(join(output, "paper.md"), sections.join("\n\n") + "\n", {
    mode: 0o600,
  });
  await writeFile(
    join(output, "manifest.json.part"),
    JSON.stringify(manifest, null, 2),
    { mode: 0o600 },
  );
  await rename(
    join(output, "manifest.json.part"),
    join(output, "manifest.json"),
  );
  process.stdout.write(
    JSON.stringify({
      event: "done",
      pages: pdf.numPages,
      processedPages,
      assets: blocks.filter((b) => b.image).length,
      elapsedMilliseconds: manifest.elapsedMilliseconds,
      peakRSSBytes: manifest.peakRSSBytes,
    }) + "\n",
  );
} finally {
  await loading.destroy();
  await session.release();
}

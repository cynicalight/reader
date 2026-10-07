import { createCanvas } from "@napi-rs/canvas";
import * as ort from "onnxruntime-node";
import { expect, it } from "vitest";
import { detectRegions } from "./detect";
import { digest, model } from "./model";

// Opt-in: READER_TEST_LAYOUT_MODEL points at a downloaded copy of the pinned model.
const path = process.env.READER_TEST_LAYOUT_MODEL;
it.skipIf(!path)(
  "maps detections from the square model input back to the page",
  async () => {
    expect(await digest(path!)).toBe(model.sha256);
    const session = await ort.InferenceSession.create(path!);
    // A tall page catches decoding against page pixels instead of model input.
    const page = createCanvas(1000, 1400),
      c = page.getContext("2d");
    c.fillStyle = "white";
    c.fillRect(0, 0, 1000, 1400);
    c.fillStyle = "black";
    c.font = "bold 30px sans-serif";
    c.fillText("A Synthetic Study of Layout", 220, 110);
    c.font = "17px serif";
    const words =
      "the quick brown fox jumps over a lazy dog while reading layout models detect".split(
        " ",
      );
    for (let y = 180; y < 760; y += 22)
      c.fillText(
        Array.from(
          { length: 9 },
          (_, i) => words[(y + i * 7) % words.length],
        ).join(" "),
        90,
        y,
      );
    c.lineWidth = 3;
    c.strokeRect(150, 800, 700, 420);
    for (let i = 0; i < 8; i++) {
      c.fillStyle = `hsl(${i * 40},70%,50%)`;
      c.fillRect(200 + i * 80, 1180 - (i + 1) * 40, 50, (i + 1) * 40);
    }
    c.fillStyle = "black";
    c.fillText(
      "Figure 1: Bars rendered for a synthetic layout check.",
      260,
      1260,
    );
    const regions = await detectRegions(session, page);
    const chart = regions.find((r) => r.label === "chart");
    expect(chart?.bounds.x).toBeCloseTo(0.15, 1);
    expect(chart?.bounds.y).toBeCloseTo(800 / 1400, 1);
    expect(chart?.bounds.width).toBeCloseTo(0.7, 1);
    expect(chart?.bounds.height).toBeCloseTo(420 / 1400, 1);
    const text = regions.find((r) => r.label === "text");
    expect(text!.order).toBeLessThan(chart!.order);
  },
  30_000,
);

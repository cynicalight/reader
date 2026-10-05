import { expect, it } from "vitest";
import { orderPageBlocks } from "./reading-order";
import blocks from "./fixtures/oze-page7.json";
it("moves the premature heading below Graph without changing IDs or boxes", () => {
  const ordered = orderPageBlocks(blocks);
  expect(ordered.map((b) => b.id)).toEqual([
    "p7-b2",
    "p7-b3",
    "p7-b5",
    "p7-b4",
    "p7-b6",
    "p7-b7",
  ]);
  expect(new Set(ordered)).toEqual(new Set(blocks));
});
it("retains left-before-right columns around spanning bands", () => {
  const block = (
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => ({ id, bounds: { x, y, width, height } });
  const title = block("title", 0.1, 0.05, 0.8, 0.05),
    left1 = block("l1", 0.1, 0.2, 0.35, 0.15),
    left2 = block("l2", 0.1, 0.4, 0.35, 0.15),
    right1 = block("r1", 0.55, 0.2, 0.35, 0.15),
    right2 = block("r2", 0.55, 0.4, 0.35, 0.15),
    wide = block("wide", 0.1, 0.6, 0.8, 0.1),
    end = block("end", 0.1, 0.8, 0.35, 0.1);
  expect(
    orderPageBlocks([title, left2, left1, right2, right1, wide, end]).map(
      (b) => b.id,
    ),
  ).toEqual(["title", "l1", "l2", "r1", "r2", "wide", "end"]);
});

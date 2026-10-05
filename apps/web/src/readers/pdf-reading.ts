import type { PDFLocation } from "@reader/core";

export type Box = NonNullable<PDFLocation["rects"]>[number];
export const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

export class ReadingSync {
  private owner: "source" | "translation" = "source";
  private until = 0;
  private blocked: "source" | "translation" | undefined;
  input(side: "source" | "translation") {
    this.owner = side;
    this.blocked = undefined;
    this.until = 0;
  }
  canFollow(side: "source" | "translation", now = performance.now()) {
    return this.owner === side && !(this.blocked === side && now < this.until);
  }
  following(side: "source" | "translation", now = performance.now()) {
    this.blocked = side;
    this.until = now + 700;
  }
}

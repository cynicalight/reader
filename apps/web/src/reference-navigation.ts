import type { DocumentLocation, ReaderAdapter } from "@reader/core";

// Keep the original reading position while visiting several references.
// A jump that stays on the same screen, or a reader who scrolls back, needs
// no return point.
export class ReferenceNavigation {
  origin?: DocumentLocation;
  busy = false;
  constructor(
    private reader: Pick<ReaderAdapter, "getLocation" | "goTo" | "isNear">,
  ) {}
  async visit(target: DocumentLocation) {
    if (this.busy) return;
    this.busy = true;
    const origin = this.origin || structuredClone(this.reader.getLocation());
    try {
      await this.reader.goTo(target);
      this.origin = origin;
    } finally {
      this.busy = false;
    }
    this.settle();
  }
  /** Record where a jump started outside visit(), such as a PDF link. */
  remember(origin: DocumentLocation) {
    if (!this.busy && !this.origin) this.origin = structuredClone(origin);
  }
  /** Forget the return point once it is on screen again; true if forgotten. */
  settle() {
    if (this.busy || !this.origin || !this.reader.isNear?.(this.origin))
      return false;
    this.origin = undefined;
    return true;
  }
  async back() {
    if (this.busy || !this.origin) return;
    this.busy = true;
    try {
      await this.reader.goTo(this.origin);
      this.origin = undefined;
    } finally {
      this.busy = false;
    }
  }
}

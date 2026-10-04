import type { DocumentLocation, ReaderAdapter } from "@reader/core";

// Keep the original reading position while visiting several references.
export class ReferenceNavigation {
  origin?: DocumentLocation;
  busy = false;
  constructor(private reader: Pick<ReaderAdapter, "getLocation" | "goTo">) {}
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

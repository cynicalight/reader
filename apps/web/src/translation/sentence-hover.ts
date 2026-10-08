/** Two highlight layers crossfade without changing the browser selection. */
export class SentenceHover {
  private key = "";
  private current: Highlight | undefined;
  private animations = new Map<string, number>();
  private opacity = new Map<string, number>();
  readonly name: string;
  readonly outgoing: string;
  constructor(
    private host: HTMLElement,
    prefix: string,
    private registry: HighlightRegistry,
  ) {
    this.name = `${prefix}-hover`;
    this.outgoing = `${prefix}-hover-out`;
  }
  get css() {
    return [this.name, this.outgoing]
      .map(
        (name) =>
          `::highlight(${name}) { background-color: rgb(128 128 128 / calc(var(--${name}, 0) * 0.22)); } .textLayer ::highlight(${name}) { color: transparent; }`,
      )
      .join("\n");
  }
  private reduced() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }
  private set(name: string, value: number) {
    this.opacity.set(name, value);
    this.host.style.setProperty(`--${name}`, String(value));
  }
  private animate(name: string, to: number, done?: () => void) {
    cancelAnimationFrame(this.animations.get(name) ?? 0);
    const from = this.opacity.get(name) ?? 0,
      started = performance.now();
    const step = (time: number) => {
      const progress = this.reduced()
        ? 1
        : Math.min(1, Math.max(0, (time - started) / 160));
      this.set(name, from + (to - from) * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) this.animations.set(name, requestAnimationFrame(step));
      else {
        this.animations.delete(name);
        done?.();
      }
    };
    step(started);
  }
  show(key: string, ranges: Range[]) {
    if (!ranges.length) {
      this.clear();
      return;
    }
    if (key === this.key && this.current) {
      this.current.clear();
      ranges.forEach((r) => this.current!.add(r));
      return;
    }
    if (this.current) {
      this.registry.set(this.outgoing, this.current);
      this.set(this.outgoing, this.opacity.get(this.name) ?? 0);
      this.animate(this.outgoing, 0, () => this.registry.delete(this.outgoing));
    }
    this.key = key;
    this.current = new Highlight(...ranges);
    this.registry.set(this.name, this.current);
    this.set(this.name, 0);
    this.animate(this.name, 1);
  }
  clear(immediate = false) {
    this.key = "";
    this.current = undefined;
    if (immediate || this.reduced()) {
      this.animations.forEach(cancelAnimationFrame);
      this.animations.clear();
      this.registry.delete(this.name);
      this.registry.delete(this.outgoing);
      this.set(this.name, 0);
      this.set(this.outgoing, 0);
    } else this.animate(this.name, 0, () => this.registry.delete(this.name));
  }
  destroy() {
    this.clear(true);
    this.host.style.removeProperty(`--${this.name}`);
    this.host.style.removeProperty(`--${this.outgoing}`);
  }
}

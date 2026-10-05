// Share this state across Readium frames so trackpad momentum cannot skip a
// second short chapter immediately after the first boundary transition.
export type EPUBScrollState = {
  busy: boolean;
  locked: boolean;
  lastInput: number;
  direction: number;
};

export function installEPUBScroll(
  wnd: Window,
  state: EPUBScrollState,
  active: () => boolean,
  turn: (direction: number) => Promise<void>,
  error: (reason: unknown) => void,
) {
  const doc = wnd.document;
  let disposed = false;
  let touchY: number | undefined;
  const editable = (target: EventTarget | null) =>
    !!(target as Element | null)?.closest?.(
      'input, textarea, select, [contenteditable="true"]',
    );
  const move = (delta: number, event: Event) => {
    if (
      disposed ||
      !active() ||
      !delta ||
      editable(event.target) ||
      wnd.getSelection()?.toString().trim()
    )
      return;
    const direction = Math.sign(delta);
    const now = Date.now();
    if (now - state.lastInput > 180 || direction !== state.direction)
      state.locked = false;
    state.lastInput = now;
    state.direction = direction;
    const root = doc.scrollingElement ?? doc.documentElement;
    // An overflowing code sample or table should consume its own scrolling.
    for (
      let node = event.target as Element | null;
      node && node !== root;
      node = node.parentElement
    ) {
      if (node.nodeType !== 1) continue;
      const overflow = wnd.getComputedStyle(node).overflowY;
      if (
        (overflow === "auto" || overflow === "scroll") &&
        node.scrollHeight > node.clientHeight + 1 &&
        (direction > 0
          ? node.scrollTop + node.clientHeight < node.scrollHeight - 1
          : node.scrollTop > 1)
      )
        return;
    }
    const height = root.clientHeight || wnd.innerHeight;
    if (
      direction > 0
        ? root.scrollTop + height < root.scrollHeight - 2
        : root.scrollTop > 2
    )
      return;
    event.preventDefault();
    if (state.busy || state.locked) return;
    state.busy = true;
    state.locked = true;
    void turn(direction)
      .catch((reason) => {
        if (!disposed) error(reason);
      })
      .finally(() => {
        state.busy = false;
      });
  };
  const wheel = (event: WheelEvent) => {
    if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))
      return;
    move(event.deltaY, event);
  };
  const key = (event: KeyboardEvent) => {
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.isComposing ||
      (event.shiftKey && event.key !== " ") ||
      editable(event.target)
    )
      return;
    const direction = ["ArrowDown", "PageDown"].includes(event.key)
      ? 1
      : ["ArrowUp", "PageUp"].includes(event.key)
        ? -1
        : event.key === " "
          ? event.shiftKey
            ? -1
            : 1
          : 0;
    if (direction) move(direction, event);
  };
  const touchStart = (event: TouchEvent) => {
    touchY = event.touches.length === 1 ? event.touches[0].clientY : undefined;
  };
  const touchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1 || touchY === undefined) return;
    const current = event.touches[0].clientY;
    const delta = touchY - current;
    if (Math.abs(delta) < 8) return;
    touchY = current;
    move(delta, event);
  };
  doc.addEventListener("wheel", wheel, { passive: false });
  doc.addEventListener("keydown", key);
  doc.addEventListener("touchstart", touchStart, { passive: true });
  doc.addEventListener("touchmove", touchMove, { passive: false });
  return () => {
    disposed = true;
    doc.removeEventListener("wheel", wheel);
    doc.removeEventListener("keydown", key);
    doc.removeEventListener("touchstart", touchStart);
    doc.removeEventListener("touchmove", touchMove);
  };
}

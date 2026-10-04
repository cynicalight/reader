import styles from "./scrollbars.css?inline";

/** Capture also covers scroll events from portals and nested scroll containers. */
export function installScrollbars(doc: Document) {
  const style = doc.createElement("style");
  style.textContent = styles;
  doc.head.append(style);
  const timers = new Map<Element, ReturnType<typeof setTimeout>>();
  const onScroll = (event: Event) => {
    const target = event.target === doc ? doc.scrollingElement : event.target;
    // Avoid instanceof: EPUB elements belong to a different Window.
    if (!target || !("nodeType" in target) || target.nodeType !== 1) return;
    const element = target as Element;
    clearTimeout(timers.get(element));
    element.setAttribute("data-reader-scrolling", "");
    timers.set(
      element,
      setTimeout(() => {
        element.removeAttribute("data-reader-scrolling");
        timers.delete(element);
      }, 1000),
    );
  };
  doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => {
    doc.removeEventListener("scroll", onScroll, true);
    for (const [element, timer] of timers) {
      clearTimeout(timer);
      element.removeAttribute("data-reader-scrolling");
    }
    timers.clear();
    style.remove();
  };
}

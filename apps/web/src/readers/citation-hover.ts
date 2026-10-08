import type { PDFLocation } from "@reader/core";

/** Delegate to rendered Markdown links, including lazily mounted translations. */
export function installCitationHover(
  host: HTMLElement,
  resolve: (block: string, label: string) => Promise<PDFLocation | undefined>,
  show: (location: PDFLocation, anchor: HTMLAnchorElement) => Promise<void>,
  hide: () => void,
) {
  let active: HTMLAnchorElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request = 0;
  const link = (target: EventTarget | null) =>
    target instanceof Element
      ? target.closest<HTMLAnchorElement>('a[href^="#reader-citation?"]')
      : null;
  const clear = () => {
    clearTimeout(timer);
    request++;
    if (active) hide();
    active = null;
  };
  const enter = (event: Event) => {
    const anchor = link(event.target);
    if (!anchor || anchor === active) return;
    clear();
    active = anchor;
    const id = request;
    timer = setTimeout(async () => {
      const params = new URLSearchParams(anchor.hash.split("?")[1]);
      try {
        const target = await resolve(
          params.get("block") ?? "",
          params.get("label") ?? "",
        );
        if (target && id === request && anchor.isConnected)
          await show(target, anchor);
      } catch {
        // Missing references leave the reading position unchanged.
      }
    }, 300);
  };
  const leave = (event: Event) => {
    if (!active || !link(event.target)) return;
    if (active.contains((event as MouseEvent).relatedTarget as Node | null))
      return;
    clear();
  };
  host.addEventListener("pointerover", enter);
  host.addEventListener("pointerout", leave);
  host.addEventListener("focusin", enter);
  host.addEventListener("focusout", leave);
  host.addEventListener("click", clear);
  host.addEventListener("scroll", clear, true);
  return () => {
    clear();
    host.removeEventListener("pointerover", enter);
    host.removeEventListener("pointerout", leave);
    host.removeEventListener("focusin", enter);
    host.removeEventListener("focusout", leave);
    host.removeEventListener("click", clear);
    host.removeEventListener("scroll", clear, true);
  };
}

import { openExternalLink } from "../reading-links";

/** Preserve PDF.js internal navigation and open external URLs in the system browser. */
export function installPDFExternalLinks(host: HTMLElement) {
  const click = (event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>(
      ".annotationLayer a[href]",
    );
    if (
      !link ||
      link.matches(".internalLink, [data-internal-link] a") ||
      !host.contains(link) ||
      !/^https?:\/\//i.test(link.href)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    openExternalLink(link.href);
  };
  host.addEventListener("click", click, true);
  return () => host.removeEventListener("click", click, true);
}

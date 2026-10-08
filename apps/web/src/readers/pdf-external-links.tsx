import { createRoot, type Root } from "react-dom/client";
import { Copy } from "lucide-react";
import { Button } from "@reader/ui/components/button";
import { copyText } from "../chat/clipboard";
import { openExternalLink } from "../reading-links";

/** Keep PDF.js link annotations navigable, with a separate copy action. */
export function installPDFExternalLinks(host: HTMLElement) {
  const copies = new Map<
    HTMLAnchorElement,
    { node: HTMLElement; root: Root }
  >();
  const update = () => {
    for (const [link, copy] of copies)
      if (!host.contains(link)) {
        copy.root.unmount();
        copy.node.remove();
        copies.delete(link);
      }
    for (const link of host.querySelectorAll<HTMLAnchorElement>(
      ".annotationLayer a[href]",
    )) {
      if (
        link.classList.contains("internalLink") ||
        !/^https?:\/\//i.test(link.href) ||
        copies.has(link)
      )
        continue;
      const node = document.createElement("span");
      node.className = "reader-source-link-copy";
      link.parentElement?.append(node);
      const root = createRoot(node);
      copies.set(link, { node, root });
      root.render(
        <Button
          variant="ghost"
          size="icon-xs"
          title="复制链接"
          aria-label={`复制链接 ${link.href}`}
          onClick={(event) => {
            event.stopPropagation();
            void copyText(link.href);
          }}
        >
          <Copy className="size-3" />
        </Button>,
      );
    }
  };
  const click = (event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>(
      ".annotationLayer a[href]",
    );
    if (
      !link ||
      link.classList.contains("internalLink") ||
      !host.contains(link) ||
      !/^https?:\/\//i.test(link.href)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    openExternalLink(link.href);
  };
  host.addEventListener("click", click, true);
  const observer = new MutationObserver(update);
  observer.observe(host, { childList: true, subtree: true });
  update();
  return () => {
    observer.disconnect();
    host.removeEventListener("click", click, true);
    for (const copy of copies.values()) {
      copy.root.unmount();
      copy.node.remove();
    }
    copies.clear();
  };
}

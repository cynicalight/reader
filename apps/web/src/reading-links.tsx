import { createContext } from "react";
import { toast } from "sonner";

export const ReadingLinkNavigation = createContext<
  ((blockId: string, label: string) => void) | undefined
>(undefined);

export function openExternalLink(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  if (window.readerDesktop?.openExternal)
    void window.readerDesktop
      .openExternal(url)
      .catch((e) => toast.error(e.message));
  else window.open(url, "_blank", "noopener,noreferrer");
}

export function citationHref(blockId: string, label: string) {
  return `#reader-citation?${new URLSearchParams({ block: blockId, label })}`;
}

// Work on parsed Markdown text nodes so code, links and math stay untouched.
export function remarkReadingCitations({ blockId }: { blockId?: string }) {
  return (tree: { children?: MarkdownNode[] }) => {
    if (!blockId) return;
    const visit = (parent: { children?: MarkdownNode[] }) => {
      // Leaves (math, code, breaks) must not gain a `children: undefined` key;
      // mdast-util-to-hast reads its length and throws.
      if (!parent.children) return;
      parent.children = parent.children.flatMap((node) => {
        if (node.type !== "text" || !node.value) {
          if (node.type !== "link" && node.type !== "linkReference")
            visit(node);
          return [node];
        }
        const parts: MarkdownNode[] = [];
        let start = 0;
        for (const match of node.value.matchAll(
          /\[(\d+(?:\s*[,，–-]\s*\d+)*)\]/g,
        )) {
          parts.push({
            type: "text",
            value: node.value.slice(start, match.index) + "[",
          });
          for (const token of match[1].split(/(\d+)/).filter(Boolean))
            parts.push(
              /^\d+$/.test(token)
                ? {
                    type: "link",
                    url: citationHref(blockId, token),
                    children: [{ type: "text", value: token }],
                  }
                : { type: "text", value: token },
            );
          parts.push({ type: "text", value: "]" });
          start = match.index! + match[0].length;
        }
        return start
          ? [...parts, { type: "text", value: node.value.slice(start) }]
          : [node];
      });
    };
    visit(tree);
  };
}
interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
}

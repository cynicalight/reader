import { Expand, Sparkles } from "lucide-react";
import { Button } from "@reader/ui/components/button";
import type { PDFBlock, PDFBlockAction } from "@reader/core";
export function BlockActions({
  block,
  onAction,
}: {
  block: PDFBlock;
  onAction: (block: PDFBlock, action: PDFBlockAction) => void;
}) {
  return (
    <>
      <Button
        className="block-explain"
        data-block-action="explain"
        size="icon-sm"
        variant="secondary"
        aria-label="AI 解释此图"
        title="AI 解释此图"
        onClick={(event) => {
          event.stopPropagation();
          onAction(block, "explain");
        }}
      >
        <Sparkles />
      </Button>
      <Button
        className="block-preview"
        data-block-action="preview"
        size="icon-sm"
        variant="secondary"
        aria-label="放大查看原图"
        title="放大查看原图"
        onClick={(event) => {
          event.stopPropagation();
          onAction(block, "preview");
        }}
      >
        <Expand />
      </Button>
    </>
  );
}

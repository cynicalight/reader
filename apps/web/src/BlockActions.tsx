import { Expand, Sparkles, Languages } from "lucide-react";
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
        aria-label={block.image ? "AI 解释此图" : "询问 AI 此段"}
        title={block.image ? "AI 解释此图" : "询问 AI 此段"}
        onClick={(event) => {
          event.stopPropagation();
          onAction(block, "explain");
        }}
      >
        <Sparkles />
      </Button>
      <Button
        className="block-preview"
        data-block-action={block.image ? "preview" : "translate"}
        size="icon-sm"
        variant="secondary"
        aria-label={block.image ? "放大查看原图" : "翻译整段"}
        title={block.image ? "放大查看原图" : "翻译整段"}
        onClick={(event) => {
          event.stopPropagation();
          onAction(block, block.image ? "preview" : "translate");
        }}
      >
        {block.image ? <Expand /> : <Languages />}
      </Button>
    </>
  );
}

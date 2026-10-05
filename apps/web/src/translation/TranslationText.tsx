import type { PDFBlock, TranslationBlock } from "@reader/core";
import { blockImageURL } from "@reader/api";
import { Button } from "@reader/ui/components/button";
import { MessageMarkdown } from "../chat/MessageMarkdown";

export function TranslationText({
  block,
  translation,
  documentId,
  retry,
  linked = [],
}: {
  block: PDFBlock;
  translation?: TranslationBlock;
  documentId: string;
  retry: () => void;
  linked?: number[];
}) {
  const preserve =
    [
      "reference",
      "reference_content",
      "algorithm",
      "display_formula",
      "inline_formula",
      "formula_number",
      "header",
      "footer",
      "number",
    ].includes(block.label) ||
    (!!block.image && block.label !== "table" && !block.caption);
  return (
    <>
      {block.image && (
        <img
          className="translation-image"
          src={blockImageURL(documentId, block.id)}
          alt={block.caption || block.label}
          loading="lazy"
        />
      )}
      {preserve ? (
        !block.image &&
        (block.label === "algorithm" ? (
          <pre>{block.text}</pre>
        ) : (
          <MessageMarkdown content={block.text} />
        ))
      ) : translation?.status === "complete" ? (
        <div className="translation-sentences">
          {translation.sentences.map((sentence, i) => (
            <div
              key={i}
              className="translation-sentence"
              data-sentence={i}
              data-linked={linked.includes(i) || undefined}
            >
              <MessageMarkdown content={sentence.target} />
            </div>
          ))}
        </div>
      ) : (
        <div className="translation-pending" role="status">
          <span>
            {translation?.status === "failed"
              ? translation.error || "此段翻译失败"
              : translation?.status === "running"
                ? "正在翻译…"
                : "等待翻译…"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={translation?.status === "running"}
            onClick={retry}
          >
            {translation?.status === "failed" ? "重试此段" : "优先翻译"}
          </Button>
        </div>
      )}
    </>
  );
}

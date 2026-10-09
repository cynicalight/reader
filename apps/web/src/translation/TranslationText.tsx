import { FormulaRow } from "./FormulaRow";
import type { PDFBlock, TranslationBlock } from "@reader/core";
import { blockImageURL } from "@reader/api";
import { Button } from "@reader/ui/components/button";
import { lazy, Suspense } from "react";
import { ReadingLinkNavigation } from "../reading-links";
const FormulaFragment = lazy(() => import("./FormulaFragment"));
const Markdown = lazy(() =>
  import("../chat/MessageMarkdown").then((module) => ({
    default: module.MessageMarkdown,
  })),
);
function MessageMarkdown({
  content,
  blockId,
  onCitation,
}: {
  content: string;
  blockId?: string;
  onCitation?: (blockId: string, label: string) => void;
}) {
  return (
    <Suspense fallback={<span>{content}</span>}>
      <ReadingLinkNavigation.Provider value={onCitation}>
        <Markdown
          content={content}
          citationBlockId={onCitation ? blockId : undefined}
        />
      </ReadingLinkNavigation.Provider>
    </Suspense>
  );
}

export function TranslationText({
  block,
  translation,
  documentId,
  retry,
  paused = false,
  linked = [],
  formulaNumber,
  onCitation,
  imageURL,
}: {
  // PDF blocks and EPUB paragraphs share these fields.
  block: Pick<PDFBlock, "id" | "label" | "text" | "image" | "caption"> &
    Partial<PDFBlock>;
  translation?: TranslationBlock;
  documentId: string;
  /** Requests this block; also used for blocks that were never requested. */
  retry: () => void;
  paused?: boolean;
  linked?: number[];
  formulaNumber?: string;
  onCitation?: (blockId: string, label: string) => void;
  /** EPUB images come from the publication rather than the PDF asset store. */
  imageURL?: string;
}) {
  const formula = ["display_formula", "inline_formula"].includes(block.label);
  const idle = translation?.status === "idle";
  const halted = paused && translation?.status === "pending";
  const asset =
    !!block.image || ["table", "chart", "image"].includes(block.label);
  const image = block.image ? (
    <img
      className="translation-image"
      src={imageURL ?? blockImageURL(documentId, block.id)}
      alt={block.caption || block.text || block.label}
      loading="lazy"
    />
  ) : null;
  const formulaFallback = image || <MessageMarkdown content={block.text} />;
  if (
    formula &&
    translation?.status === "complete" &&
    translation.formulaMarkdown
  ) {
    return (
      <Suspense
        fallback={
          <FormulaRow number={formulaNumber}>{formulaFallback}</FormulaRow>
        }
      >
        <FormulaFragment
          content={translation.formulaMarkdown}
          fallback={formulaFallback}
          number={formulaNumber}
        />
      </Suspense>
    );
  }
  if (formula)
    return (
      <div>
        <FormulaRow number={formulaNumber}>{formulaFallback}</FormulaRow>
        {block.image && (
          <div className="translation-formula-status" role="status">
            {translation?.status === "failed" ? (
              <>
                <span>{translation.error || "公式转换失败"}</span>
                <Button variant="ghost" size="sm" onClick={retry}>
                  重试公式
                </Button>
              </>
            ) : idle ? (
              <Button variant="ghost" size="sm" onClick={retry}>
                转换公式
              </Button>
            ) : (
              <span>{halted ? "翻译已暂停" : "公式转换中…"}</span>
            )}
          </div>
        )}
      </div>
    );
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
    (asset && !block.caption);
  return (
    <>
      {image}
      {preserve ? (
        !asset &&
        (block.label === "algorithm" ? (
          <pre>{block.text}</pre>
        ) : (
          <MessageMarkdown
            content={block.text}
            blockId={block.id}
            onCitation={onCitation}
          />
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
              <MessageMarkdown
                content={sentence.target}
                blockId={block.id}
                onCitation={onCitation}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="translation-pending" role="status">
          <span>
            {translation?.status === "failed"
              ? translation.error || "此段翻译失败"
              : idle
                ? "未翻译"
                : halted
                  ? "翻译已暂停"
                  : "正在翻译中…"}
          </span>
          {(translation?.status === "failed" || idle) && (
            <Button variant="ghost" size="sm" onClick={retry}>
              {idle ? "翻译此段" : "重试此段"}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

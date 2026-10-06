import { FormulaRow } from "./FormulaRow";
import type { PDFBlock, TranslationBlock } from "@reader/core";
import { blockImageURL } from "@reader/api";
import { Button } from "@reader/ui/components/button";
import { lazy, Suspense } from "react";
const FormulaFragment = lazy(() => import("./FormulaFragment"));
const Markdown = lazy(() =>
  import("../chat/MessageMarkdown").then((module) => ({
    default: module.MessageMarkdown,
  })),
);
function MessageMarkdown({ content }: { content: string }) {
  return (
    <Suspense fallback={<span>{content}</span>}>
      <Markdown content={content} />
    </Suspense>
  );
}

export function TranslationText({
  block,
  translation,
  documentId,
  retry,
  linked = [],
  formulaNumber,
}: {
  block: PDFBlock;
  translation?: TranslationBlock;
  documentId: string;
  retry: () => void;
  linked?: number[];
  formulaNumber?: string;
}) {
  const formula = ["display_formula", "inline_formula"].includes(block.label);
  const asset =
    !!block.image || ["table", "chart", "image"].includes(block.label);
  const image = block.image ? (
    <img
      className="translation-image"
      src={blockImageURL(documentId, block.id)}
      alt={block.caption || block.label}
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
            ) : (
              <span>公式转换中…</span>
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
              : "正在翻译中…"}
          </span>
          {translation?.status === "failed" && (
            <Button variant="ghost" size="sm" onClick={retry}>
              重试此段
            </Button>
          )}
        </div>
      )}
    </>
  );
}

import type { DocumentLocation } from "@reader/core";
/** The marked side keeps its exact excerpt; its counterpart uses whole sentences. */
export function AnnotationQuote({
  quote,
  location,
}: {
  quote: string;
  location: DocumentLocation;
}) {
  const pair = location.type === "pdf" ? location.sentenceLink : undefined;
  if (!pair?.parts.length) return <>{quote}</>;
  const source =
    pair.origin === "source"
      ? quote
      : pair.parts.map((p) => p.source).join(" ");
  const target =
    pair.origin === "translation"
      ? quote
      : pair.parts.map((p) => p.target).join(" ");
  return (
    <span className="annotation-quote-pair">
      <span>
        <span className="annotation-quote-label">原文</span>
        <span>{source}</span>
      </span>
      <span>
        <span className="annotation-quote-label">译文</span>
        <span>{target}</span>
      </span>
    </span>
  );
}

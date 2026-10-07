import { FormulaRow } from "./FormulaRow";
import katex from "katex";
import { MessageMarkdown } from "../chat/MessageMarkdown";
import type { ReactNode } from "react";

export default function FormulaFragment({
  content,
  fallback,
  number,
}: {
  content: string;
  fallback: ReactNode;
  number?: string;
}) {
  const expressions = [...content.matchAll(/\$\$([\s\S]*?)\$\$/g)];
  try {
    if (!expressions.length)
      return <FormulaRow number={number}>{fallback}</FormulaRow>;
    for (const expression of expressions) {
      katex.renderToString(expression[1], {
        throwOnError: true,
        trust: false,
        strict: "ignore",
        maxExpand: 100,
        maxSize: 20,
      });
    }
  } catch {
    return <FormulaRow number={number}>{fallback}</FormulaRow>;
  }
  return (
    <div className="translation-formula">
      <FormulaRow number={number}>
        <MessageMarkdown content={content} />
      </FormulaRow>
      {fallback && (
        <details className="translation-formula-source">
          <summary>查看原公式</summary>
          {fallback}
        </details>
      )}
    </div>
  );
}

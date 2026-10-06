import katex from "katex";
import { MessageMarkdown } from "../chat/MessageMarkdown";
import type { ReactNode } from "react";

export default function FormulaFragment({
  content,
  fallback,
}: {
  content: string;
  fallback: ReactNode;
}) {
  const expressions = [...content.matchAll(/\$\$([\s\S]*?)\$\$/g)];
  try {
    if (!expressions.length) return fallback;
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
    return fallback;
  }
  return (
    <div className="translation-formula">
      <MessageMarkdown content={content} />
      {fallback && (
        <details className="translation-formula-source">
          <summary>查看原公式</summary>
          {fallback}
        </details>
      )}
    </div>
  );
}

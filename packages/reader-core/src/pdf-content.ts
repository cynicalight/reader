import type { PDFBlock } from "./index";

// Keep this classification in sync with the server translation filter.
export function isPDFPageDecoration(
  block: Pick<PDFBlock, "label" | "text" | "bounds">,
): boolean {
  if (
    ["header", "footer", "number", "header_image", "footer_image"].includes(
      block.label,
    )
  )
    return true;
  // Explicit semantic labels take precedence over the pre-parsing fallback.
  if (!["", "text"].includes(block.label)) return false;
  const b = block.bounds;
  return (
    (b.y < 0.1 || b.y + b.height > 0.9) &&
    b.width < 0.18 &&
    b.height < 0.045 &&
    /^(?:page\s+)?[-–—]?\s*(?:\d{1,5}|[ivxlcdm]{1,8})\s*[-–—]?$/i.test(
      block.text.trim(),
    )
  );
}

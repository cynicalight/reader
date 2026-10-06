// PDF physical page numbers, never printed page labels. A bounded request must
// not silently fall back to a whole-document pass when its input is invalid.
export function selectProcessingPages(
  total: number,
  requested?: string,
): number[] {
  if (!Number.isInteger(total) || total < 1 || total > 1000)
    throw new Error("PDF 超过本轮处理上限（1000 页）或页数无效");
  if (requested === undefined)
    return Array.from({ length: total }, (_, i) => i + 1);
  if (!/^[1-9][0-9]*(,[1-9][0-9]*)*$/.test(requested))
    throw new Error("无效的处理页码");
  const pages = requested.split(",").map(Number);
  if (pages.some((page) => page > 1000)) throw new Error("无效的处理页码");
  const selected = [...new Set(pages)]
    .filter((p) => p <= total)
    .sort((a, b) => a - b);
  if (!selected.length) throw new Error("页码超出文档范围");
  return selected;
}

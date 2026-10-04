interface TextItem {
  str: string;
  transform: number[];
  height: number;
}
interface Viewport {
  width: number;
  height: number;
  convertToViewportPoint(x: number, y: number): number[];
}
// Match against the same space-joined text used by PDF search. Position the
// first matching text run, retaining PDF.js coordinates and page rotation.
export function pdfQuotePoint(
  items: TextItem[],
  quote: string,
  viewport: Viewport,
) {
  const needle = quote.trim().toLocaleLowerCase();
  if (!needle) return;
  const index = items
    .map((item) => item.str)
    .join(" ")
    .toLocaleLowerCase()
    .indexOf(needle);
  if (index < 0) return;
  let offset = 0;
  for (const item of items) {
    if (index < offset + item.str.length) {
      const [x, baseline] = viewport.convertToViewportPoint(
        item.transform[4],
        item.transform[5],
      );
      return {
        x: Math.max(0, Math.min(1, x / viewport.width)),
        y: Math.max(0, Math.min(1, (baseline - item.height) / viewport.height)),
      };
    }
    offset += item.str.length + 1;
  }
}

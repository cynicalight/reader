import type { Annotation, HighlightColor, ReaderTheme } from "@reader/core";

export function activeAnnotation(items: Annotation[], ids: string[]) {
  const matches = items.filter((item) => ids.includes(item.id));
  // Prefer an existing note when different kinds mark the same passage.
  return (
    matches.find((item) => item.note.trim()) ??
    matches.find((item) => item.kind === "note") ??
    matches[0]
  );
}

export function applySavedAnnotation(
  items: Annotation[],
  saved: Annotation & { replacedIds?: string[] },
): Annotation[] {
  const { replacedIds = [], ...annotation } = saved;
  const removed = new Set(replacedIds);
  const next = items.filter((item) => !removed.has(item.id));
  const index = next.findIndex((item) => item.id === annotation.id);
  if (index < 0) next.push(annotation);
  else next[index] = annotation;
  return next;
}

/** Reading order: page and vertical position for PDFs, progression for EPUBs. */
export function documentOrder(a: Annotation, b: Annotation) {
  const x = a.location,
    y = b.location;
  if (x.type === "pdf" && y.type === "pdf")
    return (
      x.page - y.page ||
      (x.rects?.[0]?.y ?? x.y ?? 0) - (y.rects?.[0]?.y ?? y.y ?? 0) ||
      (x.rects?.[0]?.x ?? 0) - (y.rects?.[0]?.x ?? 0)
    );
  if (x.type === "epub" && y.type === "epub" && x.href === y.href)
    return (x.progression ?? 0) - (y.progression ?? 0);
  return a.createdAt.localeCompare(b.createdAt);
}

/** Default highlight colors; the first is the color of older marks. */
export const highlightColors: HighlightColor[] = [
  { value: "#e6b94c", label: "黄色" },
  { value: "#6cc58c", label: "绿色" },
  { value: "#5b9fe8", label: "蓝色" },
  { value: "#e8746b", label: "红色" },
];
export const MAX_HIGHLIGHT_COLORS = 8;
/** Colors marks may carry from earlier palettes, so they keep their names. */
const retiredColors: HighlightColor[] = [{ value: "#a985e0", label: "紫色" }];

/** The user's palette, or the defaults when it is unset or empty. */
export const highlightPalette = (
  theme?: Pick<ReaderTheme, "highlightColors">,
) => (theme?.highlightColors?.length ? theme.highlightColors : highlightColors);

export const colorLabel = (
  color: string,
  palette: HighlightColor[] = highlightColors,
) =>
  [...palette, ...highlightColors, ...retiredColors].find(
    (c) => c.value.toLowerCase() === color.toLowerCase(),
  )?.label || "其他颜色";

export const validHighlightColor = (value: string) =>
  /^#[0-9a-f]{6}$/i.test(value);

/**
 * The reader's marks grouped by color, so questions like "how do my red
 * formulas relate" can be answered. Bookmarks carry no text and are skipped.
 */
export function annotationContext(
  annotations: Annotation[],
  limit = 4000,
  palette: HighlightColor[] = highlightColors,
) {
  const groups = new Map<string, Annotation[]>();
  for (const a of [...annotations].sort(documentOrder)) {
    if (a.kind === "bookmark" || !(a.quote || a.note)) continue;
    const label = colorLabel(a.color || highlightColors[0].value, palette);
    groups.set(label, [...(groups.get(label) || []), a]);
  }
  if (!groups.size) return "";
  const lines = ["[读者的标注，按颜色分组]"];
  for (const [label, items] of groups) {
    lines.push(`${label}（${items.length} 处）：`);
    for (const a of items) {
      const place =
        a.location.type === "pdf" ? `第 ${a.location.page} 页` : "章节";
      const quote = a.quote.replace(/\s+/g, " ").slice(0, 300);
      const note = a.note.trim()
        ? ` —— ${a.kind === "question" ? "问题" : "笔记"}：${a.note.replace(/\s+/g, " ").slice(0, 200)}`
        : "";
      lines.push(`- ${place}：${quote ? `“${quote}”` : ""}${note}`);
    }
  }
  let text = lines.join("\n");
  if (text.length > limit)
    text = text.slice(0, limit) + "\n…（其余标注已省略）";
  return text;
}

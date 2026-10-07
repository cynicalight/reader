import type { Annotation } from "@reader/core";

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

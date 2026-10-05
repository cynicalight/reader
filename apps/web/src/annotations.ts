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

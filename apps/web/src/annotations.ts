import type { Annotation } from "@reader/core";

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

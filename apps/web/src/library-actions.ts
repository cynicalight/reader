import { api } from "@reader/api";
import { forgetLibraryDocuments } from "./store";

export function toggleDocumentSelection(
  selected: Set<string>,
  visible: string[],
  id: string,
  anchor: string | null,
) {
  const next = new Set(
    [...selected].filter((value) => visible.includes(value)),
  );
  const start = anchor ? visible.indexOf(anchor) : -1;
  const end = visible.indexOf(id);
  if (end < 0) return next;
  if (start >= 0) {
    for (const value of visible.slice(
      Math.min(start, end),
      Math.max(start, end) + 1,
    ))
      next.add(value);
  } else if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export async function removeLibraryDocuments(ids: string[]) {
  const deleted: string[] = [],
    failed: string[] = [];
  for (const id of new Set(ids)) {
    try {
      await api.removeDocument(id);
      deleted.push(id);
      forgetLibraryDocuments([id]);
    } catch {
      failed.push(id);
    }
  }
  return { deleted, failed };
}

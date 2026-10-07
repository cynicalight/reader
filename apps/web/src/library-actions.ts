import { api } from "@reader/api";
import { toast } from "sonner";
import { forgetLibraryDocuments, refreshLibrary, refreshTrash } from "./store";

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
      await api.trashDocument(id);
      deleted.push(id);
      forgetLibraryDocuments([id]);
    } catch {
      failed.push(id);
    }
  }
  void refreshTrash().catch(() => {});
  return { deleted, failed };
}

export async function restoreLibraryDocuments(ids: string[]) {
  let restored = 0;
  for (const id of new Set(ids)) {
    try {
      await api.restoreDocument(id);
      restored++;
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  await Promise.all([refreshLibrary(), refreshTrash()]);
  return restored;
}

/** Move to the trash and offer an undo; failures stay in place for a retry. */
export async function trashWithUndo(ids: string[]) {
  const result = await removeLibraryDocuments(ids);
  if (result.deleted.length)
    toast.success(`已将 ${result.deleted.length} 份移到回收站`, {
      action: {
        label: "撤销",
        onClick: () => void restoreLibraryDocuments(result.deleted),
      },
    });
  if (result.failed.length)
    toast.error(`${result.failed.length} 份未能移到回收站，已保留，可重试`);
  return result;
}

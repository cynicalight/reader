import { api } from "@reader/api";
import type {
  Document,
  PaperLibraryPreferences,
  ReadingStatus,
} from "@reader/core";
import { toast } from "sonner";
import {
  refreshLibrary,
  updateLibraryPreferences,
  useReaderStore,
} from "../store";
import {
  paperCategories,
  removeCategoryPreferences,
  renameCategoryPreferences,
  validCategory,
} from "./model";
import { usePaperUI } from "./state";

type Patch = Parameters<typeof api.update>[1];

const papers = () =>
  useReaderStore.getState().documents.filter((d) => d.library === "papers");
const paperPrefs = () =>
  useReaderStore.getState().libraryPreferences.papers || {};

export function savePaperPreferences(
  change: (prefs: PaperLibraryPreferences) => PaperLibraryPreferences,
) {
  return updateLibraryPreferences({ papers: change(paperPrefs()) }).catch((e) =>
    toast.error((e as Error).message),
  );
}

/**
 * Apply patches optimistically, save them one by one, then reload. Failed
 * papers are reported and the reload restores their saved state.
 */
export async function patchPapers(changes: [Document, Patch][]) {
  if (!changes.length) return 0;
  const state = useReaderStore.getState();
  const local = new Map(changes.map(([doc, patch]) => [doc.id, patch]));
  state.setDocuments(
    state.documents.map((doc) =>
      local.has(doc.id)
        ? ({
            ...doc,
            ...local.get(doc.id),
            metadata: { ...doc.metadata, ...local.get(doc.id)!.metadata },
          } as Document)
        : doc,
    ),
  );
  let failed = 0;
  let message = "";
  for (const [doc, patch] of changes) {
    try {
      await api.update(doc.id, patch);
    } catch (e) {
      failed++;
      message = (e as Error).message;
    }
  }
  await refreshLibrary().catch(() => {});
  if (failed) toast.error(`${failed} 篇未能保存：${message}`);
  return changes.length - failed;
}

const hasTag = (doc: Document, name: string) =>
  doc.tags.some((tag) => tag.toLowerCase() === name.toLowerCase());

export function addToCategory(docs: Document[], name: string) {
  return patchPapers(
    docs
      .filter((doc) => !hasTag(doc, name))
      .map((doc) => [doc, { tags: [...doc.tags, name] }]),
  );
}
export function removeFromCategory(docs: Document[], name: string) {
  return patchPapers(
    docs
      .filter((doc) => hasTag(doc, name))
      .map((doc) => [
        doc,
        {
          tags: doc.tags.filter(
            (tag) => tag.toLowerCase() !== name.toLowerCase(),
          ),
        },
      ]),
  );
}
export const toggleCategory = (doc: Document, name: string) =>
  hasTag(doc, name)
    ? removeFromCategory([doc], name)
    : addToCategory([doc], name);

export const setReadingStatus = (
  docs: Document[],
  readingStatus: ReadingStatus,
) =>
  patchPapers(
    docs
      .filter((doc) => doc.readingStatus !== readingStatus)
      .map((doc) => [doc, { readingStatus }]),
  );
export const setStarred = (docs: Document[], favorite: boolean) =>
  patchPapers(
    docs
      .filter((doc) => doc.favorite !== favorite)
      .map((doc) => [doc, { favorite }]),
  );

/** Create a category, optionally placing papers in it. Returns false on bad names. */
export async function createCategory(name: string, docs: Document[] = []) {
  name = name.trim();
  if (!validCategory(name)) {
    toast.error("分类名须为 1–40 个字符");
    return false;
  }
  const existing = paperCategories(paperPrefs(), papers()).find(
    (item) => item.toLowerCase() === name.toLowerCase(),
  );
  if (!existing)
    await savePaperPreferences((prefs) => ({
      ...prefs,
      categories: [...paperCategories(prefs, papers()), name],
    }));
  if (docs.length) await addToCategory(docs, existing || name);
  return true;
}

export async function renameCategory(from: string, to: string) {
  to = to.trim();
  if (to === from) return true;
  if (!validCategory(to)) {
    toast.error("分类名须为 1–40 个字符");
    return false;
  }
  const categories = paperCategories(paperPrefs(), papers());
  if (
    categories.some(
      (item) => item !== from && item.toLowerCase() === to.toLowerCase(),
    )
  ) {
    toast.error(`已有名为“${to}”的分类`);
    return false;
  }
  try {
    await api.changeLibraryTag("papers", from, to);
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  }
  await savePaperPreferences((prefs) =>
    renameCategoryPreferences(prefs, categories, from, to),
  );
  const ui = usePaperUI.getState();
  if (ui.view === `tag:${from}`) ui.setView(`tag:${to}`);
  await refreshLibrary().catch(() => {});
  return true;
}

export async function deleteCategory(name: string) {
  const categories = paperCategories(paperPrefs(), papers());
  try {
    await api.changeLibraryTag("papers", name);
  } catch (e) {
    toast.error((e as Error).message);
    return;
  }
  await savePaperPreferences((prefs) =>
    removeCategoryPreferences(prefs, categories, name),
  );
  const ui = usePaperUI.getState();
  if (ui.view === `tag:${name}`) ui.setView("all");
  await refreshLibrary().catch(() => {});
}

export function openLink(url: string) {
  if (!url) return;
  if (window.readerDesktop?.openExternal)
    void window.readerDesktop
      .openExternal(url)
      .catch((e) => toast.error((e as Error).message));
  else window.open(url, "_blank", "noopener,noreferrer");
}

export function revealFile(doc: Document, open = false) {
  const desktop = window.readerDesktop;
  if (!desktop?.showDocumentFile) {
    toast.info("请在桌面版中打开文件");
    return;
  }
  void (open ? desktop.openDocumentFile : desktop.showDocumentFile)(
    doc.id,
    doc.type,
  ).catch((e) => toast.error((e as Error).message));
}

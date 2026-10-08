import { create } from "zustand";
import {
  defaultTheme,
  type Document,
  type ReaderTheme,
  type AIConfig,
  type LibraryMode,
  type LibraryPreferences,
  type ReaderLinkTarget,
} from "@reader/core";
import { api } from "@reader/api";
export const useReaderStore = create<{
  documents: Document[];
  active: Document | null;
  theme: ReaderTheme;
  aiConfig?: AIConfig;
  aiModelSaving: boolean;
  libraryPreferences: LibraryPreferences;
  trash: Document[];
  setTrash: (trash: Document[]) => void;
  /** A reader:// target waiting for its document to open. */
  linkTarget: ReaderLinkTarget | null;
  setLinkTarget: (target: ReaderLinkTarget | null) => void;
  setLibraryPreferences: (preferences: LibraryPreferences) => void;
  setAIConfig: (config: AIConfig) => void;
  setAIModelSaving: (saving: boolean) => void;
  setDocuments: (documents: Document[]) => void;
  open: (active: Document | null) => void;
  setTheme: (patch: Partial<ReaderTheme>) => void;
}>((set) => ({
  documents: [],
  active: null,
  theme: defaultTheme,
  aiModelSaving: false,
  libraryPreferences: {},
  trash: [],
  setTrash: (trash) => set({ trash }),
  linkTarget: null,
  setLinkTarget: (linkTarget) => set({ linkTarget }),
  setLibraryPreferences: (libraryPreferences) => set({ libraryPreferences }),
  setAIConfig: (aiConfig) => set({ aiConfig }),
  setAIModelSaving: (aiModelSaving) => set({ aiModelSaving }),
  setDocuments: (documents) => set({ documents }),
  open: (active) => set({ active }),
  setTheme: (patch) =>
    set((state) => ({ theme: { ...state.theme, ...patch } })),
}));
let libraryRevision = 0;
export function forgetLibraryDocuments(ids: string[]) {
  ++libraryRevision;
  const state = useReaderStore.getState();
  state.setDocuments(state.documents.filter((d) => !ids.includes(d.id)));
  if (state.active && ids.includes(state.active.id)) state.open(null);
}
export async function refreshLibrary() {
  const revision = ++libraryRevision;
  const documents = await api.documents();
  if (revision === libraryRevision)
    useReaderStore.getState().setDocuments(documents);
}
export async function refreshAIConfig() {
  const before = useReaderStore.getState().aiConfig;
  const config = await api.aiConfig();
  // A concurrent settings save owns its newer snapshot.
  if (useReaderStore.getState().aiConfig === before)
    useReaderStore.getState().setAIConfig(config);
}
export const libraryMode = (preferences: LibraryPreferences): LibraryMode =>
  preferences.mode === "papers" ? "papers" : "books";
export async function loadLibraryPreferences() {
  useReaderStore
    .getState()
    .setLibraryPreferences(await api.libraryPreferences());
}
let preferenceWrite = Promise.resolve();
/** Apply locally at once; writes are serialized so the last change wins. */
export function updateLibraryPreferences(patch: Partial<LibraryPreferences>) {
  const state = useReaderStore.getState();
  const next = { ...state.libraryPreferences, ...patch };
  state.setLibraryPreferences(next);
  preferenceWrite = preferenceWrite
    .catch(() => {})
    .then(() => api.saveLibraryPreferences(next))
    .then(() => {});
  return preferenceWrite;
}
let trashRevision = 0;
/** The trash of the current library; older responses never overwrite newer ones. */
export async function refreshTrash() {
  const revision = ++trashRevision;
  const state = useReaderStore.getState();
  const trash = await api.trash(libraryMode(state.libraryPreferences));
  if (revision === trashRevision) useReaderStore.getState().setTrash(trash);
}
/** Open the document a reader:// link points to, in its own library. */
export async function openLinkTarget(target: ReaderLinkTarget) {
  let doc = useReaderStore.getState().documents.find((d) => d.id === target.id);
  if (!doc) {
    await refreshLibrary();
    doc = useReaderStore.getState().documents.find((d) => d.id === target.id);
  }
  if (!doc) return false;
  const state = useReaderStore.getState();
  if (libraryMode(state.libraryPreferences) !== doc.library)
    void updateLibraryPreferences({ mode: doc.library }).catch(() => {});
  state.setLinkTarget(target);
  if (state.active?.id !== doc.id) state.open(doc);
  return true;
}

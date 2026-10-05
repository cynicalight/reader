import { create } from "zustand";
import {
  defaultTheme,
  type Document,
  type ReaderTheme,
  type AIConfig,
} from "@reader/core";
import { api } from "@reader/api";
export const useReaderStore = create<{
  documents: Document[];
  active: Document | null;
  theme: ReaderTheme;
  aiConfig?: AIConfig;
  aiModelSaving: boolean;
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

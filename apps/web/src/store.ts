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
export async function refreshLibrary() {
  useReaderStore.getState().setDocuments(await api.documents());
}
export async function refreshAIConfig() {
  const before = useReaderStore.getState().aiConfig;
  const config = await api.aiConfig();
  // A concurrent settings save owns its newer snapshot.
  if (useReaderStore.getState().aiConfig === before)
    useReaderStore.getState().setAIConfig(config);
}

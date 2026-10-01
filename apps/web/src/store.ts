import { create } from "zustand";
import { defaultTheme, type Document, type ReaderTheme } from "@reader/core";
import { api } from "@reader/api";
export const useReaderStore = create<{
  documents: Document[];
  active: Document | null;
  theme: ReaderTheme;
  setDocuments: (documents: Document[]) => void;
  open: (active: Document | null) => void;
  setTheme: (patch: Partial<ReaderTheme>) => void;
}>((set) => ({
  documents: [],
  active: null,
  theme: defaultTheme,
  setDocuments: (documents) => set({ documents }),
  open: (active) => set({ active }),
  setTheme: (patch) =>
    set((state) => ({ theme: { ...state.theme, ...patch } })),
}));
export async function refreshLibrary() {
  useReaderStore.getState().setDocuments(await api.documents());
}

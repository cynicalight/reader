import { create } from "zustand";
import type { PaperView } from "./model";

/** Session state shared by the paper sidebar, list and detail panel. */
export const usePaperUI = create<{
  view: PaperView;
  query: string;
  selectedId: string | null;
  picking: boolean;
  picked: Set<string>;
  anchor: string | null;
  /** Papers to place in a category being named, or null when closed. */
  naming: string[] | null;
  setNaming: (ids: string[] | null) => void;
  setView: (view: PaperView) => void;
  setQuery: (query: string) => void;
  select: (id: string | null) => void;
  startPicking: (ids?: string[]) => void;
  stopPicking: () => void;
  /** Toggle one paper, or add the range from the last anchor with shift. */
  togglePick: (id: string, range: boolean, visible: string[]) => void;
  setPicked: (ids: Iterable<string>) => void;
}>((set) => ({
  view: "all",
  query: "",
  selectedId: null,
  picking: false,
  picked: new Set(),
  anchor: null,
  naming: null,
  setNaming: (naming) => set({ naming }),
  setView: (view) => set({ view }),
  setQuery: (query) => set({ query }),
  select: (selectedId) => set({ selectedId }),
  startPicking: (ids = []) =>
    set({ picking: true, picked: new Set(ids), selectedId: null }),
  stopPicking: () => set({ picking: false, picked: new Set(), anchor: null }),
  togglePick: (id, range, visible) =>
    set((state) => {
      const picked = new Set(state.picked);
      const from = state.anchor ? visible.indexOf(state.anchor) : -1;
      const to = visible.indexOf(id);
      if (range && from >= 0 && to >= 0)
        for (const item of visible.slice(
          Math.min(from, to),
          Math.max(from, to) + 1,
        ))
          picked.add(item);
      else if (picked.has(id)) picked.delete(id);
      else picked.add(id);
      return { picked, anchor: id, picking: true };
    }),
  setPicked: (ids) => set({ picked: new Set(ids) }),
}));

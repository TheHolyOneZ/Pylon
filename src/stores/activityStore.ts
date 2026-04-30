import { create } from "zustand";

export type ActivityType = "info" | "success" | "error" | "warning" | "transfer";

export interface ActivityEntry {
  id: string;
  ts: number;
  type: ActivityType;
  message: string;
  detail?: string;
}

interface ActivityStore {
  entries: ActivityEntry[];
  add: (entry: Omit<ActivityEntry, "id" | "ts">) => void;
  clear: () => void;
}

const MAX_ENTRIES = 500;

export const useActivityStore = create<ActivityStore>((set) => ({
  entries: [],

  add: (entry) =>
    set((s) => ({
      entries: [
        { ...entry, id: crypto.randomUUID(), ts: Date.now() },
        ...s.entries,
      ].slice(0, MAX_ENTRIES),
    })),

  clear: () => set({ entries: [] }),
}));

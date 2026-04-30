import { create } from "zustand";
import { persist } from "zustand/middleware";
import { LocalEntry, RemoteEntry, SortState, FileViewMode, Bookmark } from "../types";
import * as api from "../lib/tauri";

export type OverwritePolicy = "ask" | "overwrite_all" | "skip_all";

interface FileStore {
  localPath: string;
  remotePath: string;
  localHistory: string[];
  remoteHistory: string[];
  localHistoryIndex: number;
  remoteHistoryIndex: number;

  localEntries: LocalEntry[];
  remoteEntries: RemoteEntry[];
  localRawEntries: LocalEntry[];
  remoteRawEntries: RemoteEntry[];
  localAllCount: number;
  remoteAllCount: number;
  localLoading: boolean;
  remoteLoading: boolean;
  remoteError: string | null;

  selectedLocal: Set<string>;
  selectedRemote: Set<string>;
  lastClickedLocalIndex: number;
  lastClickedRemoteIndex: number;

  localSort: SortState;
  remoteSort: SortState;

  viewMode: FileViewMode;
  showHidden: boolean;
  localFilter: string;
  remoteFilter: string;

  bookmarks: Bookmark[];

  overwritePolicy: OverwritePolicy;
  setOverwritePolicy: (p: OverwritePolicy) => void;

  navigateLocal: (path: string, addHistory?: boolean) => Promise<void>;
  navigateRemote: (sessionId: string, path: string, addHistory?: boolean) => Promise<void>;
  navigateLocalBack: () => Promise<void>;
  navigateLocalForward: () => Promise<void>;
  navigateRemoteBack: (sessionId: string) => Promise<void>;
  navigateRemoteForward: (sessionId: string) => Promise<void>;
  refreshLocal: () => Promise<void>;
  refreshRemote: (sessionId: string) => Promise<void>;

  selectLocal: (path: string, index: number, shift: boolean, ctrl: boolean) => void;
  selectRemote: (path: string, index: number, shift: boolean, ctrl: boolean) => void;
  selectAllLocal: () => void;
  selectAllRemote: () => void;
  clearSelection: () => void;

  setLocalSort: (field: SortState["field"]) => void;
  setRemoteSort: (field: SortState["field"]) => void;

  setViewMode: (m: FileViewMode) => void;
  toggleHidden: () => void;
  localRegexMode: boolean;
  remoteRegexMode: boolean;
  setLocalFilter: (f: string) => void;
  setRemoteFilter: (f: string) => void;
  setLocalRegexMode: (v: boolean) => void;
  setRemoteRegexMode: (v: boolean) => void;

  addBookmark: (label: string, path: string, side: "local" | "remote") => void;
  removeBookmark: (id: string) => void;
}

function applyHiddenFilter<T extends { name: string }>(entries: T[], showHidden: boolean): T[] {
  if (!showHidden) return entries.filter((e) => !e.name.startsWith("."));
  return entries;
}

export function applyTextFilter<T extends { name: string }>(entries: T[], filter: string, regexMode = false): T[] {
  if (!filter.trim()) return entries;
  if (regexMode) {
    try {
      const re = new RegExp(filter, "i");
      return entries.filter((e) => re.test(e.name));
    } catch {
      return entries;
    }
  }
  const q = filter.toLowerCase();
  const scored = entries
    .map((e) => {
      const n = e.name.toLowerCase();
      const sub = n.indexOf(q);
      if (sub >= 0) return { e, score: 200 - sub + (sub === 0 ? 100 : 0) };
      let qi = 0, consec = 0, maxConsec = 0, last = -1;
      for (let ni = 0; ni < n.length && qi < q.length; ni++) {
        if (n[ni] === q[qi]) {
          consec = last === ni - 1 ? consec + 1 : 1;
          maxConsec = Math.max(maxConsec, consec);
          last = ni; qi++;
        } else { consec = 0; }
      }
      if (qi < q.length) return null;
      return { e, score: maxConsec };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  scored.sort((a, b) => b.score - a.score);
  return scored.map((x) => x.e);
}

function sortEntries<T extends { name: string; size: number | null; modified: number | null; is_dir: boolean }>(
  entries: T[],
  sort: SortState
): T[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    switch (sort.field) {
      case "size":     return dir * ((a.size ?? 0) - (b.size ?? 0));
      case "modified": return dir * ((a.modified ?? 0) - (b.modified ?? 0));
      case "type": {
        const extA = a.name.includes(".") ? a.name.split(".").pop()! : "";
        const extB = b.name.includes(".") ? b.name.split(".").pop()! : "";
        return dir * extA.localeCompare(extB);
      }
      default: return dir * a.name.localeCompare(b.name);
    }
  });
}

function buildLocal(raw: LocalEntry[], filter: string, showHidden: boolean, sort: SortState, regexMode = false) {
  const hidden = applyHiddenFilter(raw, showHidden);
  return {
    localRawEntries: raw,
    localAllCount: hidden.length,
    localEntries: sortEntries(applyTextFilter(hidden, filter, regexMode), sort),
  };
}

function buildRemote(raw: RemoteEntry[], filter: string, showHidden: boolean, sort: SortState, regexMode = false) {
  const hidden = applyHiddenFilter(raw, showHidden);
  return {
    remoteRawEntries: raw,
    remoteAllCount: hidden.length,
    remoteEntries: sortEntries(applyTextFilter(hidden, filter, regexMode), sort),
  };
}

export const useFileStore = create<FileStore>()(
  persist(
    (set, get) => ({
      localPath: "/",
      remotePath: "/",
      localHistory: ["/"],
      remoteHistory: ["/"],
      localHistoryIndex: 0,
      remoteHistoryIndex: 0,

      localEntries: [],
      remoteEntries: [],
      localRawEntries: [],
      remoteRawEntries: [],
      localAllCount: 0,
      remoteAllCount: 0,
      localLoading: false,
      remoteLoading: false,
      remoteError: null,

      selectedLocal: new Set(),
      selectedRemote: new Set(),
      lastClickedLocalIndex: -1,
      lastClickedRemoteIndex: -1,

      localSort: { field: "name", dir: "asc" },
      remoteSort: { field: "name", dir: "asc" },

      viewMode: "list",
      showHidden: false,
      localFilter: "",
      remoteFilter: "",
      localRegexMode: false,
      remoteRegexMode: false,

      bookmarks: [],

      overwritePolicy: "ask" as OverwritePolicy,
      setOverwritePolicy: (p) => set({ overwritePolicy: p }),

      navigateLocal: async (path, addHistory = true) => {
        set((s) => {
          const history = addHistory
            ? [...s.localHistory.slice(0, s.localHistoryIndex + 1), path]
            : s.localHistory;
          const idx = addHistory ? history.length - 1 : s.localHistoryIndex;
          return { localLoading: true, localPath: path, selectedLocal: new Set(), localHistory: history, localHistoryIndex: idx };
        });
        try {
          const raw = await api.listLocalDir(path);
          const { localSort, showHidden, localFilter, localRegexMode } = get();
          set(buildLocal(raw, localFilter, showHidden, localSort, localRegexMode));
        } finally {
          set({ localLoading: false });
        }
      },

      navigateRemote: async (sessionId, path, addHistory = true) => {
        set((s) => {
          const history = addHistory
            ? [...s.remoteHistory.slice(0, s.remoteHistoryIndex + 1), path]
            : s.remoteHistory;
          const idx = addHistory ? history.length - 1 : s.remoteHistoryIndex;
          return { remoteLoading: true, remotePath: path, remoteError: null, selectedRemote: new Set(), remoteHistory: history, remoteHistoryIndex: idx };
        });
        try {
          const raw = await api.listRemoteDir(sessionId, path);
          const { remoteSort, showHidden, remoteFilter, remoteRegexMode } = get();
          set({ ...buildRemote(raw, remoteFilter, showHidden, remoteSort, remoteRegexMode), remoteError: null });
        } catch (e: any) {
          set({ remoteEntries: [], remoteError: String(e?.message ?? e) });
        } finally {
          set({ remoteLoading: false });
        }
      },

      navigateLocalBack: async () => {
        const { localHistory, localHistoryIndex } = get();
        if (localHistoryIndex <= 0) return;
        const newIdx = localHistoryIndex - 1;
        set({ localHistoryIndex: newIdx });
        await get().navigateLocal(localHistory[newIdx], false);
      },

      navigateLocalForward: async () => {
        const { localHistory, localHistoryIndex } = get();
        if (localHistoryIndex >= localHistory.length - 1) return;
        const newIdx = localHistoryIndex + 1;
        set({ localHistoryIndex: newIdx });
        await get().navigateLocal(localHistory[newIdx], false);
      },

      navigateRemoteBack: async (sessionId) => {
        const { remoteHistory, remoteHistoryIndex } = get();
        if (remoteHistoryIndex <= 0) return;
        const newIdx = remoteHistoryIndex - 1;
        set({ remoteHistoryIndex: newIdx });
        await get().navigateRemote(sessionId, remoteHistory[newIdx], false);
      },

      navigateRemoteForward: async (sessionId) => {
        const { remoteHistory, remoteHistoryIndex } = get();
        if (remoteHistoryIndex >= remoteHistory.length - 1) return;
        const newIdx = remoteHistoryIndex + 1;
        set({ remoteHistoryIndex: newIdx });
        await get().navigateRemote(sessionId, remoteHistory[newIdx], false);
      },

      refreshLocal: async () => {
        const { localPath, localSort, showHidden, localFilter, localRegexMode } = get();
        const raw = await api.listLocalDir(localPath);
        set(buildLocal(raw, localFilter, showHidden, localSort, localRegexMode));
      },

      refreshRemote: async (sessionId) => {
        const { remotePath, remoteSort, showHidden, remoteFilter, remoteRegexMode } = get();
        try {
          const raw = await api.listRemoteDir(sessionId, remotePath);
          set({ ...buildRemote(raw, remoteFilter, showHidden, remoteSort, remoteRegexMode), remoteError: null });
        } catch (e: any) {
          set({ remoteEntries: [], remoteError: String(e?.message ?? e) });
        }
      },

      selectLocal: (path, index, shift, ctrl) => {
        set((s) => {
          const next = new Set(s.selectedLocal);
          if (shift && s.lastClickedLocalIndex >= 0) {
            const entries = s.localEntries;
            const lo = Math.min(s.lastClickedLocalIndex, index);
            const hi = Math.max(s.lastClickedLocalIndex, index);
            for (let i = lo; i <= hi; i++) next.add(entries[i].path);
          } else if (ctrl) {
            next.has(path) ? next.delete(path) : next.add(path);
          } else {
            next.clear();
            next.add(path);
          }
          return { selectedLocal: next, lastClickedLocalIndex: index };
        });
      },

      selectRemote: (path, index, shift, ctrl) => {
        set((s) => {
          const next = new Set(s.selectedRemote);
          if (shift && s.lastClickedRemoteIndex >= 0) {
            const entries = s.remoteEntries;
            const lo = Math.min(s.lastClickedRemoteIndex, index);
            const hi = Math.max(s.lastClickedRemoteIndex, index);
            for (let i = lo; i <= hi; i++) next.add(entries[i].path);
          } else if (ctrl) {
            next.has(path) ? next.delete(path) : next.add(path);
          } else {
            next.clear();
            next.add(path);
          }
          return { selectedRemote: next, lastClickedRemoteIndex: index };
        });
      },

      selectAllLocal: () =>
        set((s) => ({ selectedLocal: new Set(s.localEntries.map((e) => e.path)) })),

      selectAllRemote: () =>
        set((s) => ({ selectedRemote: new Set(s.remoteEntries.map((e) => e.path)) })),

      clearSelection: () =>
        set({ selectedLocal: new Set(), selectedRemote: new Set() }),

      setLocalSort: (field) =>
        set((s) => {
          const dir = s.localSort.field === field && s.localSort.dir === "asc" ? "desc" : "asc";
          const sort: SortState = { field, dir };
          const hidden = applyHiddenFilter(s.localRawEntries, s.showHidden);
          return { localSort: sort, localEntries: sortEntries(applyTextFilter(hidden, s.localFilter, s.localRegexMode), sort) };
        }),

      setRemoteSort: (field) =>
        set((s) => {
          const dir = s.remoteSort.field === field && s.remoteSort.dir === "asc" ? "desc" : "asc";
          const sort: SortState = { field, dir };
          const hidden = applyHiddenFilter(s.remoteRawEntries, s.showHidden);
          return { remoteSort: sort, remoteEntries: sortEntries(applyTextFilter(hidden, s.remoteFilter, s.remoteRegexMode), sort) };
        }),

      setViewMode: (m) => set({ viewMode: m }),

      toggleHidden: () =>
        set((s) => {
          const showHidden = !s.showHidden;
          const lh = applyHiddenFilter(s.localRawEntries, showHidden);
          const rh = applyHiddenFilter(s.remoteRawEntries, showHidden);
          return {
            showHidden,
            localAllCount: lh.length,
            remoteAllCount: rh.length,
            localEntries: sortEntries(applyTextFilter(lh, s.localFilter, s.localRegexMode), s.localSort),
            remoteEntries: sortEntries(applyTextFilter(rh, s.remoteFilter, s.remoteRegexMode), s.remoteSort),
          };
        }),

      setLocalFilter: (f) =>
        set((s) => {
          const hidden = applyHiddenFilter(s.localRawEntries, s.showHidden);
          return { localFilter: f, localEntries: sortEntries(applyTextFilter(hidden, f, s.localRegexMode), s.localSort) };
        }),

      setRemoteFilter: (f) =>
        set((s) => {
          const hidden = applyHiddenFilter(s.remoteRawEntries, s.showHidden);
          return { remoteFilter: f, remoteEntries: sortEntries(applyTextFilter(hidden, f, s.remoteRegexMode), s.remoteSort) };
        }),

      setLocalRegexMode: (v) =>
        set((s) => {
          const hidden = applyHiddenFilter(s.localRawEntries, s.showHidden);
          return { localRegexMode: v, localEntries: sortEntries(applyTextFilter(hidden, s.localFilter, v), s.localSort) };
        }),

      setRemoteRegexMode: (v) =>
        set((s) => {
          const hidden = applyHiddenFilter(s.remoteRawEntries, s.showHidden);
          return { remoteRegexMode: v, remoteEntries: sortEntries(applyTextFilter(hidden, s.remoteFilter, v), s.remoteSort) };
        }),

      addBookmark: (label, path, side) => {
        const id = `bm-${Date.now()}`;
        set((s) => ({ bookmarks: [...s.bookmarks, { id, label, path, side }] }));
      },

      removeBookmark: (id) =>
        set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.id !== id) })),
    }),
    {
      name: "pylon-file-store",
      partialize: (s) => ({
        localPath: s.localPath,
        localSort: s.localSort,
        remoteSort: s.remoteSort,
        viewMode: s.viewMode,
        showHidden: s.showHidden,
        bookmarks: s.bookmarks,
      }),
    }
  )
);

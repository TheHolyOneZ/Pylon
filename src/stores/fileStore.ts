import { create } from "zustand";
import { persist } from "zustand/middleware";
import { LocalEntry, RemoteEntry, SortState, FileViewMode, Bookmark } from "../types";
import * as api from "../lib/tauri";
import { errMsg } from "../lib/format";
import { normalizeLocal } from "../lib/path";

export type OverwritePolicy = "ask" | "overwrite_all" | "skip_all";
export type Pane = "local" | "remote";

interface FileStore {
  localPath: string;
  remotePath: string;
  remotePathBySession: Record<string, string>;
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
  localError: string | null;
  remoteError: string | null;

  selectedLocal: Set<string>;
  selectedRemote: Set<string>;
  lastClickedLocalIndex: number;
  lastClickedRemoteIndex: number;
  cursorLocal: string | null;
  cursorRemote: string | null;
  activePane: Pane;

  localSort: SortState;
  remoteSort: SortState;

  viewMode: FileViewMode;
  showHidden: boolean;
  localFilter: string;
  remoteFilter: string;
  localRegexMode: boolean;
  remoteRegexMode: boolean;

  bookmarks: Bookmark[];

  overwritePolicy: OverwritePolicy;
  setOverwritePolicy: (p: OverwritePolicy) => void;

  setActivePane: (p: Pane) => void;
  setCursor: (pane: Pane, path: string | null) => void;

  navigateLocal: (path: string, addHistory?: boolean) => Promise<void>;
  navigateRemote: (sessionId: string, path: string, addHistory?: boolean) => Promise<void>;
  openSession: (sessionId: string, fallbackPath: string) => Promise<void>;
  forgetSession: (sessionId: string) => void;
  navigateLocalBack: () => Promise<void>;
  navigateLocalForward: () => Promise<void>;
  navigateRemoteBack: (sessionId: string) => Promise<void>;
  navigateRemoteForward: (sessionId: string) => Promise<void>;
  refreshLocal: () => Promise<void>;
  refreshRemote: (sessionId: string) => Promise<void>;

  selectLocal: (path: string, index: number, shift: boolean, ctrl: boolean) => void;
  selectRemote: (path: string, index: number, shift: boolean, ctrl: boolean) => void;
  setSelection: (pane: Pane, paths: string[]) => void;
  selectAllLocal: () => void;
  selectAllRemote: () => void;
  clearSelection: () => void;

  setLocalSort: (field: SortState["field"]) => void;
  setRemoteSort: (field: SortState["field"]) => void;

  setViewMode: (m: FileViewMode) => void;
  toggleHidden: () => void;
  setLocalFilter: (f: string) => void;
  setRemoteFilter: (f: string) => void;
  setLocalRegexMode: (v: boolean) => void;
  setRemoteRegexMode: (v: boolean) => void;

  addBookmark: (label: string, path: string, side: "local" | "remote") => void;
  removeBookmark: (id: string) => void;
}

type Named = { name: string; hidden?: boolean };

function applyHiddenFilter<T extends Named>(entries: T[], showHidden: boolean): T[] {
  if (showHidden) return entries;
  return entries.filter((e) => !(e.hidden ?? e.name.startsWith(".")));
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
      if (sub >= 0) return { e, score: 1000 - sub + (sub === 0 ? 500 : 0) };
      let qi = 0, consec = 0, maxConsec = 0, last = -2;
      for (let ni = 0; ni < n.length && qi < q.length; ni++) {
        if (n[ni] === q[qi]) {
          consec = last === ni - 1 ? consec + 1 : 1;
          maxConsec = Math.max(maxConsec, consec);
          last = ni;
          qi++;
        }
      }
      if (qi < q.length) return null;
      return { e, score: maxConsec };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  scored.sort((a, b) => b.score - a.score);
  return scored.map((x) => x.e);
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function sortEntries<T extends { name: string; size: number | null; modified: number | null; is_dir: boolean }>(entries: T[], sort: SortState): T[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  const ext = (n: string) => (n.lastIndexOf(".") > 0 ? n.slice(n.lastIndexOf(".") + 1).toLowerCase() : "");
  return [...entries].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    let r = 0;
    switch (sort.field) {
      case "size": r = (a.size ?? 0) - (b.size ?? 0); break;
      case "modified": r = (a.modified ?? 0) - (b.modified ?? 0); break;
      case "type": r = collator.compare(ext(a.name), ext(b.name)); break;
    }
    return dir * (r || collator.compare(a.name, b.name));
  });
}

function view<T extends Named & { size: number | null; modified: number | null; is_dir: boolean }>(
  raw: T[], filter: string, showHidden: boolean, sort: SortState, regex: boolean,
) {
  const visible = applyHiddenFilter(raw, showHidden);
  const filtered = applyTextFilter(visible, filter, regex);
  return { all: visible.length, entries: filter.trim() && !regex ? filtered : sortEntries(filtered, sort) };
}

let localReq = 0;
let remoteReq = 0;

export const useFileStore = create<FileStore>()(
  persist(
    (set, get) => {
      const buildLocal = (raw: LocalEntry[]) => {
        const s = get();
        const v = view(raw, s.localFilter, s.showHidden, s.localSort, s.localRegexMode);
        return { localRawEntries: raw, localAllCount: v.all, localEntries: v.entries };
      };
      const buildRemote = (raw: RemoteEntry[]) => {
        const s = get();
        const v = view(raw, s.remoteFilter, s.showHidden, s.remoteSort, s.remoteRegexMode);
        return { remoteRawEntries: raw, remoteAllCount: v.all, remoteEntries: v.entries };
      };
      const rebuildLocal = () => set(buildLocal(get().localRawEntries));
      const rebuildRemote = () => set(buildRemote(get().remoteRawEntries));

      const loadLocal = async (path: string) => {
        const req = ++localReq;
        set({ localLoading: true });
        try {
          const raw = await api.listLocalDir(path);
          if (req !== localReq) return;
          set({ ...buildLocal(raw), localError: null });
        } catch (e) {
          if (req !== localReq) return;
          set({ localRawEntries: [], localEntries: [], localAllCount: 0, localError: errMsg(e) });
        } finally {
          if (req === localReq) set({ localLoading: false });
        }
      };

      const loadRemote = async (sessionId: string, path: string) => {
        const req = ++remoteReq;
        set({ remoteLoading: true });
        try {
          const raw = await api.listRemoteDir(sessionId, path);
          if (req !== remoteReq) return;
          set({ ...buildRemote(raw), remoteError: null });
        } catch (e) {
          if (req !== remoteReq) return;
          set({ remoteRawEntries: [], remoteEntries: [], remoteAllCount: 0, remoteError: errMsg(e) });
        } finally {
          if (req === remoteReq) set({ remoteLoading: false });
        }
      };

      return {
        localPath: "/",
        remotePath: "/",
        remotePathBySession: {},
        localHistory: [],
        remoteHistory: [],
        localHistoryIndex: -1,
        remoteHistoryIndex: -1,

        localEntries: [],
        remoteEntries: [],
        localRawEntries: [],
        remoteRawEntries: [],
        localAllCount: 0,
        remoteAllCount: 0,
        localLoading: false,
        remoteLoading: false,
        localError: null,
        remoteError: null,

        selectedLocal: new Set(),
        selectedRemote: new Set(),
        lastClickedLocalIndex: -1,
        lastClickedRemoteIndex: -1,
        cursorLocal: null,
        cursorRemote: null,
        activePane: "local",

        localSort: { field: "name", dir: "asc" },
        remoteSort: { field: "name", dir: "asc" },

        viewMode: "list",
        showHidden: false,
        localFilter: "",
        remoteFilter: "",
        localRegexMode: false,
        remoteRegexMode: false,

        bookmarks: [],

        overwritePolicy: "ask",
        setOverwritePolicy: (p) => set({ overwritePolicy: p }),

        setActivePane: (p) => { if (get().activePane !== p) set({ activePane: p }); },
        setCursor: (pane, path) => set(pane === "local" ? { cursorLocal: path } : { cursorRemote: path }),

        navigateLocal: async (rawPath, addHistory = true) => {
          const path = normalizeLocal(rawPath);
          set((s) => {
            const history = addHistory && s.localHistory[s.localHistoryIndex] !== path
              ? [...s.localHistory.slice(0, s.localHistoryIndex + 1), path].slice(-100)
              : s.localHistory;
            return {
              localPath: path,
              selectedLocal: new Set(),
              cursorLocal: null,
              lastClickedLocalIndex: -1,
              localFilter: "",
              localHistory: history,
              localHistoryIndex: addHistory ? history.length - 1 : s.localHistoryIndex,
            };
          });
          await loadLocal(path);
        },

        navigateRemote: async (sessionId, path, addHistory = true) => {
          set((s) => {
            const history = addHistory && s.remoteHistory[s.remoteHistoryIndex] !== path
              ? [...s.remoteHistory.slice(0, s.remoteHistoryIndex + 1), path].slice(-100)
              : s.remoteHistory;
            return {
              remotePath: path,
              remotePathBySession: { ...s.remotePathBySession, [sessionId]: path },
              selectedRemote: new Set(),
              cursorRemote: null,
              lastClickedRemoteIndex: -1,
              remoteFilter: "",
              remoteHistory: history,
              remoteHistoryIndex: addHistory ? history.length - 1 : s.remoteHistoryIndex,
            };
          });
          await loadRemote(sessionId, path);
        },

        openSession: async (sessionId, fallbackPath) => {
          const path = get().remotePathBySession[sessionId] ?? fallbackPath;
          set({ remoteHistory: [], remoteHistoryIndex: -1, remoteRawEntries: [], remoteEntries: [], remoteError: null });
          await get().navigateRemote(sessionId, path);
        },

        forgetSession: (sessionId) =>
          set((s) => {
            const { [sessionId]: _gone, ...rest } = s.remotePathBySession;
            return { remotePathBySession: rest };
          }),

        navigateLocalBack: async () => {
          const { localHistory, localHistoryIndex } = get();
          if (localHistoryIndex <= 0) return;
          set({ localHistoryIndex: localHistoryIndex - 1 });
          await get().navigateLocal(localHistory[localHistoryIndex - 1], false);
        },
        navigateLocalForward: async () => {
          const { localHistory, localHistoryIndex } = get();
          if (localHistoryIndex >= localHistory.length - 1) return;
          set({ localHistoryIndex: localHistoryIndex + 1 });
          await get().navigateLocal(localHistory[localHistoryIndex + 1], false);
        },
        navigateRemoteBack: async (sessionId) => {
          const { remoteHistory, remoteHistoryIndex } = get();
          if (remoteHistoryIndex <= 0) return;
          set({ remoteHistoryIndex: remoteHistoryIndex - 1 });
          await get().navigateRemote(sessionId, remoteHistory[remoteHistoryIndex - 1], false);
        },
        navigateRemoteForward: async (sessionId) => {
          const { remoteHistory, remoteHistoryIndex } = get();
          if (remoteHistoryIndex >= remoteHistory.length - 1) return;
          set({ remoteHistoryIndex: remoteHistoryIndex + 1 });
          await get().navigateRemote(sessionId, remoteHistory[remoteHistoryIndex + 1], false);
        },

        refreshLocal: () => loadLocal(get().localPath),
        refreshRemote: (sessionId) => loadRemote(sessionId, get().remotePath),

        selectLocal: (path, index, shift, ctrl) =>
          set((s) => {
            const next = new Set(ctrl || shift ? s.selectedLocal : []);
            if (shift && s.lastClickedLocalIndex >= 0) {
              const [lo, hi] = [Math.min(s.lastClickedLocalIndex, index), Math.max(s.lastClickedLocalIndex, index)];
              for (let i = lo; i <= hi; i++) if (s.localEntries[i]) next.add(s.localEntries[i].path);
            } else if (ctrl) {
              next.has(path) ? next.delete(path) : next.add(path);
            } else {
              next.add(path);
            }
            return { selectedLocal: next, cursorLocal: path, lastClickedLocalIndex: shift ? s.lastClickedLocalIndex : index, activePane: "local" };
          }),

        selectRemote: (path, index, shift, ctrl) =>
          set((s) => {
            const next = new Set(ctrl || shift ? s.selectedRemote : []);
            if (shift && s.lastClickedRemoteIndex >= 0) {
              const [lo, hi] = [Math.min(s.lastClickedRemoteIndex, index), Math.max(s.lastClickedRemoteIndex, index)];
              for (let i = lo; i <= hi; i++) if (s.remoteEntries[i]) next.add(s.remoteEntries[i].path);
            } else if (ctrl) {
              next.has(path) ? next.delete(path) : next.add(path);
            } else {
              next.add(path);
            }
            return { selectedRemote: next, cursorRemote: path, lastClickedRemoteIndex: shift ? s.lastClickedRemoteIndex : index, activePane: "remote" };
          }),

        setSelection: (pane, paths) =>
          set(pane === "local" ? { selectedLocal: new Set(paths) } : { selectedRemote: new Set(paths) }),

        selectAllLocal: () => set((s) => ({ selectedLocal: new Set(s.localEntries.map((e) => e.path)) })),
        selectAllRemote: () => set((s) => ({ selectedRemote: new Set(s.remoteEntries.map((e) => e.path)) })),
        clearSelection: () => set({ selectedLocal: new Set(), selectedRemote: new Set() }),

        setLocalSort: (field) => {
          const s = get().localSort;
          set({ localSort: { field, dir: s.field === field && s.dir === "asc" ? "desc" : "asc" } });
          rebuildLocal();
        },
        setRemoteSort: (field) => {
          const s = get().remoteSort;
          set({ remoteSort: { field, dir: s.field === field && s.dir === "asc" ? "desc" : "asc" } });
          rebuildRemote();
        },

        setViewMode: (m) => set({ viewMode: m }),
        toggleHidden: () => {
          set((s) => ({ showHidden: !s.showHidden }));
          rebuildLocal();
          rebuildRemote();
        },
        setLocalFilter: (f) => { set({ localFilter: f }); rebuildLocal(); },
        setRemoteFilter: (f) => { set({ remoteFilter: f }); rebuildRemote(); },
        setLocalRegexMode: (v) => { set({ localRegexMode: v }); rebuildLocal(); },
        setRemoteRegexMode: (v) => { set({ remoteRegexMode: v }); rebuildRemote(); },

        addBookmark: (label, path, side) =>
          set((s) => ({ bookmarks: [...s.bookmarks, { id: `bm-${Date.now()}`, label, path, side }] })),
        removeBookmark: (id) => set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.id !== id) })),
      };
    },
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
    },
  ),
);

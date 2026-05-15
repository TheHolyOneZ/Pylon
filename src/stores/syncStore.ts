import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { PersistedWatcherConfig, SyncConfig, SyncConfirmRequest, SyncRule } from "../types";

export interface SyncEventEntry {
  id: string;
  syncId: string;
  relPath: string;
  kind: string;
  skipped: boolean;
  ts: number;
}

interface SyncStore {
  syncs: SyncConfig[];
  suspendedSyncs: PersistedWatcherConfig[];
  events: SyncEventEntry[];
  errors: Record<string, string>;
  confirms: SyncConfirmRequest[];

  setSyncs: (syncs: SyncConfig[]) => void;
  addSync: (s: SyncConfig) => void;
  removeSync: (id: string) => void;
  patchSyncRule: (id: string, rule: SyncRule) => void;
  patchSyncKeepOnDisconnect: (id: string, keep: boolean) => void;
  patchSyncDryRun: (id: string, dryRun: boolean) => void;
  clearError: (id: string) => void;
  addConfirm: (c: SyncConfirmRequest) => void;
  removeConfirm: (requestId: string) => void;
  setSuspendedSyncs: (syncs: PersistedWatcherConfig[]) => void;
  removeSuspendedSync: (id: string) => void;

  startListening: () => (() => void);
}

export const useSyncStore = create<SyncStore>((set) => ({
  syncs: [],
  suspendedSyncs: [],
  events: [],
  errors: {},
  confirms: [],

  setSyncs: (syncs) => set({ syncs }),

  addSync: (s) =>
    set((state) => ({ syncs: [...state.syncs.filter((x) => x.id !== s.id), s] })),

  removeSync: (id) =>
    set((state) => ({
      syncs: state.syncs.filter((s) => s.id !== id),
      errors: Object.fromEntries(Object.entries(state.errors).filter(([k]) => k !== id)),
    })),

  patchSyncRule: (id, rule) =>
    set((state) => ({
      syncs: state.syncs.map((s) => s.id === id ? { ...s, rule } : s),
    })),

  patchSyncKeepOnDisconnect: (id, keep) =>
    set((state) => ({
      syncs: state.syncs.map((s) => s.id === id ? { ...s, keep_on_disconnect: keep } : s),
    })),

  patchSyncDryRun: (id, dryRun) =>
    set((state) => ({
      syncs: state.syncs.map((s) => s.id === id ? { ...s, dry_run: dryRun } : s),
    })),

  clearError: (id) =>
    set((state) => {
      const errors = { ...state.errors };
      delete errors[id];
      return { errors };
    }),

  addConfirm: (c) =>
    set((state) => ({ confirms: [...state.confirms, c] })),

  removeConfirm: (requestId) =>
    set((state) => ({ confirms: state.confirms.filter((r) => r.request_id !== requestId) })),

  setSuspendedSyncs: (suspendedSyncs) => set({ suspendedSyncs }),

  removeSuspendedSync: (id) =>
    set((state) => ({ suspendedSyncs: state.suspendedSyncs.filter((s) => s.id !== id) })),

  startListening: () => {
    const subs: Promise<() => void>[] = [
      listen<{ sync_id: string; rel_path: string; kind: string; skipped: boolean }>(
        "sync://event",
        (e) => {
          const { payload: p } = e;
          set((state) => {
            const entry: SyncEventEntry = {
              id: crypto.randomUUID(),
              syncId: p.sync_id, relPath: p.rel_path,
              kind: p.kind, skipped: p.skipped, ts: Date.now(),
            };
            const errors = { ...state.errors };
            delete errors[p.sync_id];
            return { events: [entry, ...state.events].slice(0, 500), errors };
          });
        }
      ),
      listen<{ sync_id: string; sync_label: string; reason: string }>(
        "sync://error",
        (e) => {
          set((state) => ({ errors: { ...state.errors, [e.payload.sync_id]: e.payload.reason } }));
        }
      ),
      listen<SyncConfirmRequest>(
        "sync://confirm_request",
        (e) => {
          set((state) => ({ confirms: [...state.confirms, e.payload] }));
        }
      ),
      listen<{ request_id: string }>(
        "sync://confirm_timeout",
        (e) => {
          set((state) => ({ confirms: state.confirms.filter((r) => r.request_id !== e.payload.request_id) }));
        }
      ),
      listen<{ sync_id: string; label: string }>(
        "sync://resumed",
        (e) => {
          set((state) => ({
            suspendedSyncs: state.suspendedSyncs.filter((s) => s.id !== e.payload.sync_id),
          }));
        }
      ),
      listen<PersistedWatcherConfig>(
        "sync://suspended",
        (e) => {
          set((state) => ({
            syncs: state.syncs.filter((s) => s.id !== e.payload.id),
            errors: Object.fromEntries(Object.entries(state.errors).filter(([k]) => k !== e.payload.id)),
            suspendedSyncs: [...state.suspendedSyncs.filter((s) => s.id !== e.payload.id), e.payload],
          }));
        }
      ),
      listen<{ sync_id: string; sync_label: string }>(
        "sync://done",
        (e) => {

          set((state) => ({
            syncs: state.syncs.map((s) =>
              s.id === e.payload.sync_id ? { ...s, active: false } : s
            ),
          }));
        }
      ),
    ];

    return () => { subs.forEach((p) => p.then((fn) => fn())); };
  },
}));

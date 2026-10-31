import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { ChecksumResult, TransferProgress, TransferRecord, TransferState } from "../types";
import * as api from "../lib/tauri";
import { parentLocal, parentRemote, sameDir } from "../lib/path";
import { useFileStore } from "./fileStore";
import { useConnectionStore } from "./connectionStore";

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const dirty = { local: false, remote: new Set<string>() };
function scheduleRefreshFor(t: TransferRecord) {
  const fs = useFileStore.getState();
  if (t.direction === "download") {
    if (sameDir(parentLocal(t.local_path), fs.localPath)) dirty.local = true;
  } else if (t.session_id === useConnectionStore.getState().activeSessionId && parentRemote(t.remote_path) === fs.remotePath) {
    dirty.remote.add(t.session_id);
  }
  if (refreshTimer || (!dirty.local && dirty.remote.size === 0)) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    const f = useFileStore.getState();
    if (dirty.local) f.refreshLocal();
    dirty.remote.forEach((sid) => f.refreshRemote(sid));
    dirty.local = false;
    dirty.remote.clear();
  }, 250);
}

export const isFailed = (s: TransferState): s is { failed: string } => typeof s === "object" && s !== null && "failed" in s;
export const isActive = (s: TransferState) => s === "running" || s === "paused" || s === "queued";

interface TransferStore {
  transfers: TransferRecord[];
  progress: Record<string, TransferProgress>;
  speedBps: Record<string, number>;
  listening: boolean;

  startListening: () => Promise<void>;
  fetchTransfers: () => Promise<void>;
  cancelTransfer: (id: string) => Promise<void>;
  pauseTransfer: (id: string) => Promise<void>;
  resumeTransfer: (id: string) => Promise<void>;
  retryTransfer: (id: string) => Promise<void>;
  clearCompleted: () => void;
}

let pending: Record<string, TransferProgress> = {};
let scheduled = false;

export const useTransferStore = create<TransferStore>((set, get) => {
  const flush = () => {
    scheduled = false;
    const batch = pending;
    pending = {};
    set((s) => {
      const progress = { ...s.progress };
      const speedBps = { ...s.speedBps };
      for (const p of Object.values(batch)) {
        progress[p.id] = p;
        if (p.state === "running") speedBps[p.id] = p.speed_bps;
        else delete speedBps[p.id];
      }
      return {
        progress,
        speedBps,
        transfers: s.transfers.map((t) => {
          const p = batch[t.id];
          return p ? { ...t, transferred_bytes: p.transferred_bytes, total_bytes: p.total_bytes, state: p.state } : t;
        }),
      };
    });
  };

  return {
    transfers: [],
    progress: {},
    speedBps: {},
    listening: false,

    startListening: async () => {
      if (get().listening) return;
      set({ listening: true });
      await listen<TransferProgress>("transfer://progress", (event) => {
        pending[event.payload.id] = event.payload;
        if (!scheduled) {
          scheduled = true;
          requestAnimationFrame(flush);
        }
      });
      await listen<TransferRecord>("transfer://new", (event) => {
        const r = event.payload;
        set((s) => ({ transfers: [r, ...s.transfers.filter((t) => t.id !== r.id)].slice(0, 5000) }));
      });
      await listen<ChecksumResult>("transfer://complete", (event) => {
        const c = event.payload;
        const verified = c.sha256_remote ? c.verified : null;
        set((s) => ({
          transfers: s.transfers.map((t) =>
            t.id === c.transfer_id ? { ...t, sha256_local: c.sha256_local, sha256_remote: c.sha256_remote, checksum_verified: verified } : t,
          ),
        }));
        const rec = get().transfers.find((t) => t.id === c.transfer_id);
        if (rec) scheduleRefreshFor(rec);
      });
      get().fetchTransfers().catch(() => {});
    },

    fetchTransfers: async () => {
      const list = await api.listTransfers();
      set((s) => {
        const known = new Set(s.transfers.map((t) => t.id));
        return { transfers: [...list.filter((t) => !known.has(t.id)).reverse(), ...s.transfers] };
      });
    },

    cancelTransfer: async (id) => {
      await api.cancelTransfer(id);
    },

    pauseTransfer: async (id) => {
      await api.pauseTransfer(id);
      set((s) => ({ transfers: s.transfers.map((t) => (t.id === id && t.state === "running" ? { ...t, state: "paused" as const } : t)) }));
    },

    resumeTransfer: async (id) => {
      await api.resumeTransferCmd(id);
      set((s) => ({ transfers: s.transfers.map((t) => (t.id === id && t.state === "paused" ? { ...t, state: "running" as const } : t)) }));
    },

    retryTransfer: async (id) => {
      const t = get().transfers.find((tr) => tr.id === id);
      if (!t) return;
      const sid = useConnectionStore.getState().resolveSessionId(t.session_id);
      if (!useConnectionStore.getState().connections.some((c) => c.id === sid)) {
        throw new Error("That server is no longer connected — reconnect, then retry.");
      }
      set((s) => ({ transfers: s.transfers.filter((x) => x.id !== id) }));
      if (t.direction === "upload") await api.uploadFile(sid, t.local_path, t.remote_path, t.strip_metadata);
      else await api.downloadFile(sid, t.remote_path, t.local_path);
    },

    clearCompleted: () => {
      api.clearFinishedTransfers().catch(() => {});
      set((s) => {
        const keep = s.transfers.filter((t) => isActive(t.state));
        const ids = new Set(keep.map((t) => t.id));
        return {
          transfers: keep,
          progress: Object.fromEntries(Object.entries(s.progress).filter(([k]) => ids.has(k))),
        };
      });
    },
  };
});

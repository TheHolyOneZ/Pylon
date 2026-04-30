import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { TransferProgress, TransferRecord } from "../types";
import * as api from "../lib/tauri";


const SPEED_SAMPLES = 5;

interface SpeedSample { bytes: number; ts: number }

interface TransferStore {
  transfers: TransferRecord[];
  progress: Record<string, TransferProgress>;
  speedSamples: Record<string, SpeedSample[]>;
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

export const useTransferStore = create<TransferStore>((set, get) => ({
  transfers: [],
  progress: {},
  speedSamples: {},
  speedBps: {},
  listening: false,

  startListening: async () => {
    if (get().listening) return;
    set({ listening: true });
    await listen<TransferProgress>("transfer://progress", (event) => {
      const p = event.payload;
      const now = Date.now();

      set((s) => {

        const prev = s.speedSamples[p.id] ?? [];
        const samples: SpeedSample[] = [...prev, { bytes: p.transferred_bytes, ts: now }].slice(-SPEED_SAMPLES);
        const bps = (() => {
          if (samples.length < 2) return p.speed_bps ?? 0;
          const oldest = samples[0];
          const newest = samples[samples.length - 1];
          const dt = (newest.ts - oldest.ts) / 1000;
          return dt > 0 ? (newest.bytes - oldest.bytes) / dt : 0;
        })();

        return {
          progress: { ...s.progress, [p.id]: p },
          speedSamples: { ...s.speedSamples, [p.id]: samples },
          speedBps: { ...s.speedBps, [p.id]: bps },
          transfers: s.transfers.map((t) =>
            t.id === p.id
              ? { ...t, transferred_bytes: p.transferred_bytes, state: p.state }
              : t
          ),
        };
      });
    });

    await listen("transfer://new", (event: any) => {
      const record = event.payload as TransferRecord;
      set((s) => ({ transfers: [record, ...s.transfers] }));
    });
  },

  fetchTransfers: async () => {
    const transfers = await api.listTransfers();
    set({ transfers });
  },

  cancelTransfer: async (id) => {
    await api.cancelTransfer(id);
    set((s) => ({
      transfers: s.transfers.map((t) =>
        t.id === id ? { ...t, state: "cancelled" as const } : t
      ),
    }));
  },

  pauseTransfer: async (id) => {
    await api.pauseTransfer(id);
    set((s) => ({
      transfers: s.transfers.map((t) =>
        t.id === id ? { ...t, state: "paused" as const } : t
      ),
    }));
  },

  resumeTransfer: async (id) => {
    await api.resumeTransferCmd(id);
    set((s) => ({
      transfers: s.transfers.map((t) =>
        t.id === id ? { ...t, state: "running" as const } : t
      ),
    }));
  },

  retryTransfer: async (id) => {
    const t = get().transfers.find((tr) => tr.id === id);
    if (!t) return;
    try {
      if (t.direction === "upload") {
        await api.uploadFile(t.session_id, t.local_path, t.remote_path);
      } else {
        await api.downloadFile(t.session_id, t.remote_path, t.local_path);
      }
    } catch (_) {

    }
  },

  clearCompleted: () => {
    set((s) => ({
      transfers: s.transfers.filter(
        (t) =>
          t.state !== "completed" &&
          t.state !== "cancelled" &&
          typeof t.state !== "object"
      ),
    }));
  },
}));

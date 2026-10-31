import { create } from "zustand";
import { basename, dirname } from "../lib/path";

function normDir(p: string): string {
  return p.replace(/[\\/]+$/, "") || "/";
}

export interface GhostEntry {
  transferId: string;
  fileName: string;
  remotePath: string;
  remoteDir: string;
  localPath: string;
  localDir: string;
  direction: "upload" | "download";
  percent: number;
  bps: number;
  state: "queued" | "running" | "paused" | "completed" | "failed";
  sessionId: string;
}

export interface BatchGhost {
  batchId: string;
  fileName: string;
  remoteDir: string;
  localDir: string;
  direction: "upload" | "download";
  sessionId: string;
  totalFiles: number;
  doneFiles: number;
  failedFiles: number;
  fileProgress: Record<string, number>;
  fileBps: Record<string, number>;
  percent: number;
  bps: number;
  state: "running" | "completed" | "failed";
}

interface GhostStore {
  ghosts: GhostEntry[];
  batches: BatchGhost[];
  batchMap: Record<string, string>;

  addGhost: (g: Omit<GhostEntry, "percent" | "bps" | "state">) => void;
  updateGhost: (id: string, u: Partial<Pick<GhostEntry, "percent" | "bps" | "state">>) => void;
  removeGhost: (id: string) => void;

  addBatch: (b: Omit<BatchGhost, "doneFiles" | "failedFiles" | "fileProgress" | "fileBps" | "percent" | "bps" | "state">) => void;
  registerBatchFile: (transferId: string, batchId: string) => void;
  progressBatchFile: (transferId: string, percent: number, bps: number) => void;
  completeBatchFile: (transferId: string, failed: boolean) => void;
  removeBatch: (batchId: string) => void;
}

function calcAggregate(batch: BatchGhost): { percent: number; bps: number } {
  const percents = Object.values(batch.fileProgress);
  const percent = batch.totalFiles > 0
    ? percents.reduce((a, b) => a + b, 0) / batch.totalFiles
    : 0;
  const bps = Object.values(batch.fileBps).reduce((a, b) => a + b, 0);
  return { percent, bps };
}

export const useGhostStore = create<GhostStore>((set) => ({
  ghosts: [],
  batches: [],
  batchMap: {},

  addGhost: (g) =>
    set((s) => ({
      ghosts: [
        ...s.ghosts.filter((x) => x.transferId !== g.transferId),
        { ...g, percent: 0, bps: 0, state: "queued" as const },
      ],
    })),

  updateGhost: (id, u) =>
    set((s) => ({
      ghosts: s.ghosts.map((g) => g.transferId === id ? { ...g, ...u } : g),
    })),

  removeGhost: (id) =>
    set((s) => ({ ghosts: s.ghosts.filter((g) => g.transferId !== id) })),

  addBatch: (b) =>
    set((s) => ({
      batches: [
        ...s.batches.filter((x) => x.batchId !== b.batchId),
        { ...b, doneFiles: 0, failedFiles: 0, fileProgress: {}, fileBps: {}, percent: 0, bps: 0, state: "running" as const },
      ],
    })),

  registerBatchFile: (transferId, batchId) =>
    set((s) => ({ batchMap: { ...s.batchMap, [transferId]: batchId } })),

  progressBatchFile: (transferId, percent, bps) =>
    set((s) => {
      const batchId = s.batchMap[transferId];
      if (!batchId) return {};
      const batch = s.batches.find((b) => b.batchId === batchId);
      if (!batch) return {};
      const updated = {
        ...batch,
        fileProgress: { ...batch.fileProgress, [transferId]: percent },
        fileBps: { ...batch.fileBps, [transferId]: bps },
      };
      const agg = calcAggregate(updated);
      return { batches: s.batches.map((b) => b.batchId === batchId ? { ...updated, ...agg } : b) };
    }),

  completeBatchFile: (transferId, failed) =>
    set((s) => {
      const batchId = s.batchMap[transferId];
      if (!batchId) return {};
      const batch = s.batches.find((b) => b.batchId === batchId);
      if (!batch) return {};
      const doneFiles = batch.doneFiles + (failed ? 0 : 1);
      const failedFiles = batch.failedFiles + (failed ? 1 : 0);
      const updated = {
        ...batch,
        doneFiles,
        failedFiles,
        fileProgress: { ...batch.fileProgress, [transferId]: 100 },
        fileBps: { ...batch.fileBps, [transferId]: 0 },
      };
      const agg = calcAggregate(updated);
      const finished = doneFiles + failedFiles >= batch.totalFiles;
      const state: BatchGhost["state"] = finished
        ? (failedFiles === 0 ? "completed" : "failed")
        : "running";
      return { batches: s.batches.map((b) => b.batchId === batchId ? { ...updated, ...agg, state } : b) };
    }),

  removeBatch: (batchId) =>
    set((s) => ({
      batches: s.batches.filter((b) => b.batchId !== batchId),
      batchMap: Object.fromEntries(Object.entries(s.batchMap).filter(([, v]) => v !== batchId)),
    })),
}));

export function handleBatchNew(b: {
  batch_id: string;
  session_id: string;
  direction: "upload" | "download";
  name: string;
  local_dir: string;
  remote_dir: string;
  total_files: number;
}) {
  const { addBatch } = useGhostStore.getState();
  addBatch({
    batchId: b.batch_id,
    fileName: b.name.endsWith("/") ? b.name : b.name + "/",

    remoteDir: normDir(dirname(b.remote_dir)),
    localDir: normDir(dirname(b.local_dir)),
    direction: b.direction,
    sessionId: b.session_id,
    totalFiles: b.total_files,
  });
}

export function handleTransferNew(record: {
  id: string;
  session_id: string;
  direction: "upload" | "download";
  local_path: string;
  remote_path: string;
  batch_id?: string | null;
}) {
  const { addGhost, registerBatchFile } = useGhostStore.getState();

  if (record.batch_id) {
    registerBatchFile(record.id, record.batch_id);
    return;
  }

  addGhost({
    transferId: record.id,
    fileName: basename(record.direction === "upload" ? record.local_path : record.remote_path),
    remotePath: record.remote_path,
    remoteDir: normDir(dirname(record.remote_path)),
    localPath: record.local_path,
    localDir: normDir(dirname(record.local_path)),
    direction: record.direction,
    sessionId: record.session_id,
  });
}

export function handleTransferProgress(p: {
  id: string;
  percent: number;
  speed_bps: number;
  state: string;
}) {
  const store = useGhostStore.getState();
  const batchId = store.batchMap[p.id];

  if (batchId) {
    const isDone = p.state === "completed" || p.state === "cancelled";
    if (p.state === "paused" || p.state === "running") { if (p.state === "running") store.progressBatchFile(p.id, p.percent, p.speed_bps); return; }
    const isFailed = typeof p.state === "object" || p.state === "failed";

    if (isDone || isFailed) {
      store.completeBatchFile(p.id, isFailed);

      setTimeout(() => {
        const batch = useGhostStore.getState().batches.find((b) => b.batchId === batchId);
        if (batch && batch.state !== "running") {
          const delay = batch.state === "failed" ? 4000 : 1500;
          setTimeout(() => useGhostStore.getState().removeBatch(batchId), delay);
        }
      }, 150);
    } else {
      store.progressBatchFile(p.id, p.percent, p.speed_bps);
    }
    return;
  }

  const { updateGhost, removeGhost } = store;
  if (p.state === "completed" || p.state === "cancelled") {
    updateGhost(p.id, { percent: 100, state: "completed" });
    setTimeout(() => removeGhost(p.id), 1200);
  } else if (typeof p.state === "object" || p.state === "failed") {
    updateGhost(p.id, { state: "failed" });
    setTimeout(() => removeGhost(p.id), 4000);
  } else {
    updateGhost(p.id, {
      percent: p.percent,
      bps: p.speed_bps,
      state: p.state as GhostEntry["state"],
    });
  }
}

export function handleBatchDone(r: { batch_id: string; failed?: number; cancelled?: boolean }) {
  const store = useGhostStore.getState();
  const batch = store.batches.find((b) => b.batchId === r.batch_id);
  if (!batch) return;
  const failed = (r.failed ?? 0) > 0 || r.cancelled;
  useGhostStore.setState((s) => ({
    batches: s.batches.map((b) => (b.batchId === r.batch_id ? { ...b, state: failed ? "failed" : "completed", percent: failed ? b.percent : 100, bps: 0 } : b)),
  }));
  setTimeout(() => useGhostStore.getState().removeBatch(r.batch_id), failed ? 4000 : 1200);
}

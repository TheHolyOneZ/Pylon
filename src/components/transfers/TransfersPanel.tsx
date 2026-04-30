import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Pause,
  Play,
  RefreshCw,
  Shield,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useTransferStore } from "../../stores/transferStore";
import { formatBytes, formatSpeed, formatETA } from "../../lib/format";
import { TransferRecord } from "../../types";
import { basename } from "../../lib/path";

function stateLabel(state: TransferRecord["state"]): string {
  if (state === "running") return "Running";
  if (state === "queued") return "Queued";
  if (state === "completed") return "Done";
  if (state === "cancelled") return "Cancelled";
  if (state === "paused") return "Paused";
  if (typeof state === "object" && "failed" in state) return `Failed`;
  return String(state);
}

function stateColor(state: TransferRecord["state"]): string {
  if (state === "running") return "text-pylon-cyan";
  if (state === "completed") return "text-pylon-green";
  if (state === "paused") return "text-pylon-amber";
  if (state === "cancelled") return "text-slate-500";
  if (typeof state === "object") return "text-pylon-red";
  return "text-slate-400";
}

export function TransfersPanel() {
  const {
    transfers, progress, speedBps,
    fetchTransfers, cancelTransfer, pauseTransfer, resumeTransfer, retryTransfer, clearCompleted,
  } = useTransferStore();

  useEffect(() => { fetchTransfers(); }, []);

  const activeCount = transfers.filter((t) => t.state === "running" || t.state === "paused").length;

  return (
    <div className="flex flex-col h-full bg-void-900">
      {}
      <div className="flex items-center gap-3 px-4 py-3 bg-void-800 border-b border-void-600">
        <Activity size={15} className="text-pylon-cyan" />
        <span className="text-sm font-semibold text-slate-200">Transfers</span>
        {activeCount > 0 && (
          <span className="px-1.5 py-0.5 rounded-full bg-pylon-cyan/15 text-pylon-cyan text-[10px] font-semibold">
            {activeCount} active
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={clearCompleted}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
        >
          <Trash2 size={11} /> Clear finished
        </button>
      </div>

      {}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {transfers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-slate-600 gap-2">
            <Activity size={28} className="opacity-30" />
            <p className="text-xs">No transfers yet — drag files to begin</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {transfers.map((t) => {
              const prog = progress[t.id];
              const pct = prog?.percent ?? (t.total_bytes > 0 ? (t.transferred_bytes / t.total_bytes) * 100 : 0);
              const bps = speedBps[t.id] ?? prog?.speed_bps ?? 0;
              const eta = prog?.eta_secs ?? null;
              const isRunning = t.state === "running";
              const isPaused = t.state === "paused";
              const isFailed = typeof t.state === "object" && "failed" in t.state;
              const isComplete = t.state === "completed";
              const barColor = t.strip_metadata ? "bg-pylon-amber" : isComplete ? "bg-pylon-green" : isFailed ? "bg-pylon-red" : "bg-pylon-cyan";
              const fileName = basename(t.local_path);

              return (
                <motion.div
                  key={t.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-void-800 border border-void-600 rounded-lg p-3 space-y-2"
                >
                  {}
                  <div className="flex items-center gap-2 min-w-0">
                    {t.direction === "upload"
                      ? <ArrowUp size={13} className="text-pylon-cyan shrink-0" />
                      : <ArrowDown size={13} className="text-pylon-violet shrink-0" />
                    }

                    <span className="text-xs text-slate-300 truncate flex-1 min-w-0" title={t.local_path}>
                      {fileName}
                    </span>

                    {t.strip_metadata && (
                      <Shield size={11} className="text-pylon-amber shrink-0" />
                    )}

                    <span className={`text-[10px] font-mono shrink-0 ${stateColor(t.state)}`}>
                      {stateLabel(t.state)}
                    </span>

                    {}
                    {isRunning && (
                      <button onClick={() => pauseTransfer(t.id)} title="Pause"
                        className="p-0.5 rounded hover:bg-void-600 text-slate-500 hover:text-pylon-amber transition-colors shrink-0">
                        <Pause size={11} />
                      </button>
                    )}
                    {isPaused && (
                      <button onClick={() => resumeTransfer(t.id)} title="Resume"
                        className="p-0.5 rounded hover:bg-void-600 text-slate-500 hover:text-pylon-cyan transition-colors shrink-0">
                        <Play size={11} />
                      </button>
                    )}
                    {isFailed && (
                      <button onClick={() => retryTransfer(t.id)} title="Retry"
                        className="p-0.5 rounded hover:bg-void-600 text-slate-500 hover:text-pylon-cyan transition-colors shrink-0">
                        <RefreshCw size={11} />
                      </button>
                    )}
                    {(isRunning || isPaused) && (
                      <button onClick={() => cancelTransfer(t.id)} title="Cancel"
                        className="p-0.5 rounded hover:bg-void-600 text-slate-500 hover:text-pylon-red transition-colors shrink-0">
                        <X size={11} />
                      </button>
                    )}
                  </div>

                  {}
                  <div className="h-1 bg-void-700 rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full ${barColor}`}
                      animate={{ width: `${pct}%` }}
                      transition={{ ease: "linear", duration: 0.3 }}
                    />
                  </div>

                  {}
                  <div className="flex justify-between items-center text-[10px] text-slate-600">
                    <span>{formatBytes(t.transferred_bytes)} / {formatBytes(t.total_bytes)}</span>
                    <span className="flex items-center gap-2">
                      {isRunning && bps > 0 && (
                        <>
                          <span className="text-pylon-cyan/70">{formatSpeed(bps)}</span>
                          <span className="text-slate-600">{formatETA(eta)}</span>
                        </>
                      )}
                      {t.retry_count > 0 && (
                        <span className="text-pylon-amber/70">retry #{t.retry_count}</span>
                      )}
                      {isComplete && t.checksum_verified === true && (
                        <span className="flex items-center gap-0.5 text-pylon-green">
                          <CheckCircle2 size={10} /> SHA-256 ✓
                        </span>
                      )}
                      {isComplete && t.checksum_verified === false && (
                        <span className="flex items-center gap-0.5 text-pylon-red">
                          <XCircle size={10} /> Mismatch
                        </span>
                      )}
                      <span>{pct.toFixed(0)}%</span>
                    </span>
                  </div>

                  {}
                  {isFailed && typeof t.state === "object" && "failed" in t.state && (
                    <p className="text-[10px] text-pylon-red/80 truncate">{t.state.failed}</p>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

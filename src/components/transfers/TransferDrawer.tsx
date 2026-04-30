import { motion, AnimatePresence } from "framer-motion";
import { Activity, ArrowDown, ArrowUp, CheckCircle, Pause, Play, RefreshCw, X } from "lucide-react";
import { useTransferStore } from "../../stores/transferStore";
import { formatBytes, formatSpeed, formatETA } from "../../lib/format";
import { basename } from "../../lib/path";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function TransferDrawer({ open, onClose }: Props) {
  const { transfers, progress, speedBps, cancelTransfer, pauseTransfer, resumeTransfer, retryTransfer } = useTransferStore();


  const visible = transfers.filter((t) =>
    t.state !== "cancelled"
  );
  const active = transfers.filter((t) => t.state === "running" || t.state === "paused" || t.state === "queued");

  return (
    <AnimatePresence>
      {open && (
        <>
          {}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[150] bg-black/20"
          />

          {}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="fixed right-0 top-8 bottom-6 z-[160] w-80 bg-void-900 border-l border-void-600 shadow-2xl flex flex-col"
          >
            {}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-void-700">
              <Activity size={14} className="text-pylon-cyan" />
              <span className="text-sm font-semibold text-slate-200">Active Transfers</span>
              {active.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-pylon-cyan/15 text-pylon-cyan text-[10px] font-semibold">
                  {active.length}
                </span>
              )}
              <div className="flex-1" />
              <button onClick={onClose} className="p-1 rounded hover:bg-void-700 text-slate-500 hover:text-slate-300 transition-colors">
                <X size={13} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {visible.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-slate-600 gap-2">
                  <Activity size={24} className="opacity-30" />
                  <p className="text-xs">No transfers</p>
                </div>
              ) : (
                visible.map((t) => {
                  const prog = progress[t.id];
                  const isDone = t.state === "completed";
                  const isFailed = typeof t.state === "object" && "failed" in t.state;
                  const pct = isDone ? 100 : prog?.percent ?? (t.total_bytes > 0 ? (t.transferred_bytes / t.total_bytes) * 100 : 0);
                  const bps = speedBps[t.id] ?? 0;
                  const eta = prog?.eta_secs ?? null;
                  const name = basename(t.local_path);

                  return (
                    <div key={t.id} className={`bg-void-800 border rounded-lg p-2.5 space-y-1.5 ${
                      isDone ? "border-pylon-green/20" : isFailed ? "border-pylon-red/20" : "border-void-700"
                    }`}>
                      <div className="flex items-center gap-2 min-w-0">
                        {t.direction === "upload"
                          ? <ArrowUp size={12} className="text-pylon-cyan shrink-0" />
                          : <ArrowDown size={12} className="text-pylon-violet shrink-0" />
                        }
                        <span className="text-xs text-slate-300 truncate flex-1">{name}</span>

                        {isDone && <CheckCircle size={11} className="text-pylon-green shrink-0" />}
                        {isFailed && (
                          <button onClick={() => retryTransfer(t.id)} title="Retry"
                            className="p-0.5 rounded hover:bg-void-600 text-pylon-red hover:text-pylon-cyan transition-colors">
                            <RefreshCw size={10} />
                          </button>
                        )}
                        {t.state === "running" && (
                          <button onClick={() => pauseTransfer(t.id)} title="Pause"
                            className="p-0.5 rounded hover:bg-void-600 text-slate-500 hover:text-pylon-amber transition-colors">
                            <Pause size={10} />
                          </button>
                        )}
                        {t.state === "paused" && (
                          <button onClick={() => resumeTransfer(t.id)} title="Resume"
                            className="p-0.5 rounded hover:bg-void-600 text-slate-500 hover:text-pylon-cyan transition-colors">
                            <Play size={10} />
                          </button>
                        )}
                        {!isDone && (
                          <button onClick={() => cancelTransfer(t.id)} title="Cancel"
                            className="p-0.5 rounded hover:bg-void-600 text-slate-500 hover:text-pylon-red transition-colors">
                            <X size={10} />
                          </button>
                        )}
                      </div>

                      {}
                      <div className="h-1 bg-void-700 rounded-full overflow-hidden">
                        <motion.div
                          className={`h-full rounded-full ${
                            isDone ? "bg-pylon-green" :
                            isFailed ? "bg-pylon-red" :
                            t.state === "running" ? "bg-pylon-cyan" : "bg-pylon-amber"
                          }`}
                          animate={{ width: `${pct}%` }}
                          transition={{ ease: "linear", duration: 0.3 }}
                        />
                      </div>

                      <div className="flex justify-between text-[10px] text-slate-600">
                        <span>{formatBytes(t.transferred_bytes)} / {formatBytes(t.total_bytes)}</span>
                        <span className="flex items-center gap-1.5">
                          {t.state === "running" && bps > 0 && (
                            <span className="text-pylon-cyan/70">{formatSpeed(bps)}</span>
                          )}
                          {t.state === "running" && eta && (
                            <span>{formatETA(eta)}</span>
                          )}
                          {isDone ? (
                            <span className="text-pylon-green/70">Done</span>
                          ) : isFailed ? (
                            <span className="text-pylon-red/70">Failed</span>
                          ) : (
                            <span>{pct.toFixed(0)}%</span>
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

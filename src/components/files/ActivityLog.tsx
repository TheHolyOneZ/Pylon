import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Activity, ArrowDown, ArrowUp, CheckCircle, Info, Trash2, TriangleAlert, XCircle } from "lucide-react";
import { useActivityStore, ActivityEntry, ActivityType } from "../../stores/activityStore";
import { useTransferStore } from "../../stores/transferStore";
import { formatBytes, formatSpeed, formatETA } from "../../lib/format";
import { basename } from "../../lib/path";

function typeIcon(type: ActivityType) {
  switch (type) {
    case "success":  return <CheckCircle size={11} className="text-pylon-green shrink-0" />;
    case "error":    return <XCircle size={11} className="text-pylon-red shrink-0" />;
    case "warning":  return <TriangleAlert size={11} className="text-pylon-amber shrink-0" />;
    case "transfer": return <Activity size={11} className="text-pylon-cyan shrink-0" />;
    default:         return <Info size={11} className="text-slate-500 shrink-0" />;
  }
}

function typeColor(type: ActivityType) {
  switch (type) {
    case "success":  return "text-pylon-green/90";
    case "error":    return "text-pylon-red/90";
    case "warning":  return "text-pylon-amber/90";
    case "transfer": return "text-pylon-cyan/80";
    default:         return "text-slate-400";
  }
}

function fmt(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function EntryRow({ entry }: { entry: ActivityEntry }) {
  return (
    <div className="flex items-start gap-2 px-3 py-1 hover:bg-void-800/60 transition-colors">
      <span className="text-[10px] text-slate-600 font-mono shrink-0 mt-0.5 w-14">{fmt(entry.ts)}</span>
      {typeIcon(entry.type)}
      <span className={`text-[11px] leading-tight ${typeColor(entry.type)} flex-1 min-w-0`}>
        {entry.message}
        {entry.detail && (
          <span className="text-slate-600 ml-1">{entry.detail}</span>
        )}
      </span>
    </div>
  );
}

function LiveTransferRows() {
  const { transfers, progress, speedBps } = useTransferStore();
  const active = transfers.filter((t) => t.state === "running" || t.state === "paused" || t.state === "queued");
  if (active.length === 0) return null;

  return (
    <>
      <div className="px-3 py-1 border-t border-void-700/50">
        <span className="text-[9px] text-slate-600 uppercase tracking-widest">Active Transfers</span>
      </div>
      {active.map((t) => {
        const prog = progress[t.id];
        const pct = prog?.percent ?? (t.total_bytes > 0 ? (t.transferred_bytes / t.total_bytes) * 100 : 0);
        const bps = speedBps[t.id] ?? 0;
        const eta = prog?.eta_secs ?? null;
        const name = basename(t.local_path).slice(0, 28);

        return (
          <div key={t.id} className="px-3 py-1.5 border-b border-void-700/30">
            <div className="flex items-center gap-1.5 mb-1">
              {t.direction === "upload"
                ? <ArrowUp size={10} className="text-pylon-cyan shrink-0" />
                : <ArrowDown size={10} className="text-pylon-violet shrink-0" />
              }
              <span className="text-[11px] text-slate-300 truncate flex-1 font-mono">{name}</span>
              <span className="text-[10px] text-slate-500 shrink-0">{pct.toFixed(0)}%</span>
              {bps > 0 && (
                <span className="text-[10px] text-pylon-cyan/70 shrink-0">{formatSpeed(bps)}</span>
              )}
              {eta && (
                <span className="text-[10px] text-slate-600 shrink-0">{formatETA(eta)}</span>
              )}
            </div>

            <div className="h-1 bg-void-700 rounded-full overflow-hidden">
              <motion.div
                className={`h-full rounded-full ${t.state === "running" ? "bg-pylon-cyan" : "bg-pylon-amber"}`}
                animate={{ width: `${pct}%` }}
                transition={{ ease: "linear", duration: 0.3 }}
              />
            </div>

            <div className="flex justify-between text-[9px] text-slate-700 mt-0.5">
              <span>{formatBytes(t.transferred_bytes)} / {formatBytes(t.total_bytes)}</span>
              <span className={`capitalize ${t.state === "paused" ? "text-pylon-amber/60" : "text-pylon-cyan/40"}`}>
                {typeof t.state === "object" ? "failed" : t.state}
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}

export function ActivityLog() {
  const { entries, clear } = useActivityStore();
  const { transfers } = useTransferStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeCount = transfers.filter((t) => t.state === "running" || t.state === "queued").length;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <div className="flex flex-col h-full bg-void-900 border-t border-void-600">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-void-800 border-b border-void-600 shrink-0">
        <Activity size={12} className="text-pylon-cyan" />
        <span className="text-[10px] font-bold text-pylon-cyan tracking-widest uppercase">Activity Log</span>
        <span className="text-[10px] text-slate-600 font-mono">{entries.length} events</span>
        {activeCount > 0 && (
          <span className="px-1.5 py-0.5 rounded-full bg-pylon-cyan/15 text-pylon-cyan text-[9px] font-semibold animate-pulse">
            {activeCount} active
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={clear}
          title="Clear log"
          className="p-1 rounded hover:bg-void-700 text-slate-600 hover:text-slate-300 transition-colors"
        >
          <Trash2 size={11} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto font-mono">
        <LiveTransferRows />

        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-700">
            <Activity size={20} className="opacity-40" />
            <p className="text-xs">No activity yet — connect to a server to begin</p>
          </div>
        ) : (
          [...entries].reverse().map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
}

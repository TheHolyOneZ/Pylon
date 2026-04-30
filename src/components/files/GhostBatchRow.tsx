import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, Folder } from "lucide-react";
import { BatchGhost } from "../../stores/ghostStore";
import { formatSpeed } from "../../lib/format";

interface Props {
  batch: BatchGhost;
}

function stateColor(state: BatchGhost["state"]) {
  switch (state) {
    case "running":   return "bg-pylon-violet";
    case "completed": return "bg-pylon-green";
    case "failed":    return "bg-pylon-red";
    default:          return "bg-slate-600";
  }
}

export function GhostBatchRow({ batch }: Props) {
  const pct = Math.min(100, Math.max(0, batch.percent));
  const total = batch.totalFiles;
  const done = batch.doneFiles + batch.failedFiles;

  return (
    <div className="relative flex items-center gap-2 px-3 py-1.5 text-sm border-b border-void-700/30 overflow-hidden select-none">
      {}
      <motion.div
        className={`absolute inset-0 origin-left opacity-[0.14] ${stateColor(batch.state)}`}
        animate={{ scaleX: pct / 100 }}
        transition={{ ease: "linear", duration: 0.3 }}
        style={{ transformOrigin: "left" }}
      />

      {}
      <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${stateColor(batch.state)} opacity-80`} />

      {}
      <span className="shrink-0 w-3 flex items-center">
        {batch.direction === "upload"
          ? <ArrowUp size={9} className="text-pylon-violet animate-pulse" />
          : <ArrowDown size={9} className="text-pylon-cyan animate-pulse" />
        }
      </span>

      {}
      <span className="shrink-0">
        <Folder size={13} className="text-pylon-violet opacity-80" />
      </span>

      {}
      <span className="flex-1 min-w-0 text-xs text-slate-300 truncate italic font-medium">
        {batch.fileName}
      </span>

      {}
      <span className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] text-pylon-violet/60 font-mono tabular-nums">
          {done}/{total} files
        </span>
        {batch.state === "running" && batch.bps > 0 && (
          <span className="text-[10px] text-pylon-violet/70 font-mono">{formatSpeed(batch.bps)}</span>
        )}
        <span className={`text-[10px] font-mono tabular-nums ${
          batch.state === "failed" ? "text-pylon-red/70" :
          batch.state === "completed" ? "text-pylon-green/70" :
          "text-slate-500"
        }`}>
          {batch.state === "failed" ? "Failed" :
           batch.state === "completed" ? "✓" :
           `${pct.toFixed(0)}%`}
        </span>
      </span>

      {}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-void-700">
        <motion.div
          className={`h-full ${stateColor(batch.state)}`}
          animate={{ width: `${pct}%` }}
          transition={{ ease: "linear", duration: 0.3 }}
        />
      </div>
    </div>
  );
}

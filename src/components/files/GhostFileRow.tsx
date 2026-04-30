import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, File, Folder } from "lucide-react";
import { GhostEntry } from "../../stores/ghostStore";
import { formatSpeed } from "../../lib/format";

interface Props {
  ghost: GhostEntry;
}

function stateColor(state: GhostEntry["state"]) {
  switch (state) {
    case "running":   return "bg-pylon-cyan";
    case "paused":    return "bg-pylon-amber";
    case "completed": return "bg-pylon-green";
    case "failed":    return "bg-pylon-red";
    default:          return "bg-slate-600";
  }
}

export function GhostFileRow({ ghost }: Props) {
  const pct = Math.min(100, Math.max(0, ghost.percent));
  const isDir = ghost.fileName.endsWith("/") || ghost.fileName.endsWith("\\");

  return (
    <div className="relative flex items-center gap-2 px-3 py-1.5 text-sm border-b border-void-700/30 overflow-hidden select-none">
      {}
      <motion.div
        className={`absolute inset-0 origin-left opacity-[0.12] ${stateColor(ghost.state)}`}
        animate={{ scaleX: pct / 100 }}
        transition={{ ease: "linear", duration: 0.25 }}
        style={{ transformOrigin: "left" }}
      />

      {}
      <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${stateColor(ghost.state)} opacity-80`} />

      {}
      <span className="shrink-0 w-3 flex items-center">
        {ghost.direction === "upload"
          ? <ArrowUp size={9} className="text-pylon-cyan animate-pulse" />
          : <ArrowDown size={9} className="text-pylon-violet animate-pulse" />
        }
      </span>

      {}
      <span className="shrink-0 opacity-50">
        {isDir
          ? <Folder size={13} className="text-pylon-violet" />
          : <File size={13} className="text-slate-500" />
        }
      </span>

      {}
      <span className="flex-1 min-w-0 text-xs text-slate-400 truncate italic">
        {ghost.fileName}
      </span>

      {}
      <span className="flex items-center gap-2 shrink-0">
        {ghost.state === "running" && ghost.bps > 0 && (
          <span className="text-[10px] text-pylon-cyan/70 font-mono">{formatSpeed(ghost.bps)}</span>
        )}
        <span className={`text-[10px] font-mono tabular-nums ${
          ghost.state === "failed" ? "text-pylon-red/70" :
          ghost.state === "completed" ? "text-pylon-green/70" :
          "text-slate-500"
        }`}>
          {ghost.state === "failed" ? "Failed" :
           ghost.state === "completed" ? "✓" :
           ghost.state === "queued" ? "queued" :
           `${pct.toFixed(0)}%`}
        </span>
      </span>

      {}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-void-700">
        <motion.div
          className={`h-full ${stateColor(ghost.state)}`}
          animate={{ width: `${pct}%` }}
          transition={{ ease: "linear", duration: 0.25 }}
        />
      </div>
    </div>
  );
}

import { ArrowDown, ArrowUp } from "lucide-react";
import { GhostEntry } from "../../stores/ghostStore";
import { formatSpeed } from "../../lib/format";
import { FileIcon } from "./fileIcons";

export function GhostFileRow({ ghost }: { ghost: GhostEntry }) {
  const pct = Math.min(100, Math.max(0, ghost.percent));
  const failed = ghost.state === "failed";
  const done = ghost.state === "completed";
  return (
    <div className="relative flex h-7 items-center gap-2 overflow-hidden px-3 text-[13px]">
      <div
        className={`absolute inset-y-0 left-0 transition-[width] duration-200 ${failed ? "bg-pylon-red/12" : done ? "bg-pylon-green/12" : "bg-pylon-cyan/10"}`}
        style={{ width: `${failed ? 100 : pct}%` }}
      />
      <FileIcon name={ghost.fileName} isDir={false} />
      <span className="relative min-w-0 flex-1 truncate text-slate-400 italic">{ghost.fileName}</span>
      <span className="relative flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
        {ghost.direction === "upload" ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
        {failed ? <span className="text-pylon-red">Failed</span> : done ? <span className="text-pylon-green">Done</span> : ghost.state === "paused" ? "Paused" : (
          <>
            {ghost.bps > 0 && <span>{formatSpeed(ghost.bps)}</span>}
            <span className="tabular w-9 text-right">{pct.toFixed(0)}%</span>
          </>
        )}
      </span>
    </div>
  );
}

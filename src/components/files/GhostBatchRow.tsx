import { ArrowDown, ArrowUp, X } from "lucide-react";
import { BatchGhost } from "../../stores/ghostStore";
import { formatSpeed } from "../../lib/format";
import { cancelBatch } from "../../lib/tauri";
import { FileIcon } from "./fileIcons";

export function GhostBatchRow({ batch }: { batch: BatchGhost }) {
  const pct = Math.min(100, Math.max(0, batch.percent));
  const failed = batch.state === "failed";
  const done = batch.state === "completed";
  const name = batch.fileName.replace(/[\\/]+$/, "");
  return (
    <div className="group relative flex h-7 items-center gap-2 overflow-hidden px-3 text-[13px]">
      <div
        className={`absolute inset-y-0 left-0 transition-[width] duration-200 ${failed ? "bg-pylon-red/12" : done ? "bg-pylon-green/12" : "bg-pylon-cyan/10"}`}
        style={{ width: `${failed ? 100 : pct}%` }}
      />
      <FileIcon name={name} isDir />
      <span className="relative min-w-0 flex-1 truncate text-slate-400 italic">{name}</span>
      <span className="relative flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
        {batch.direction === "upload" ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
        <span className="tabular">{batch.doneFiles + batch.failedFiles}/{batch.totalFiles} files</span>
        {failed ? <span className="text-pylon-red">{batch.failedFiles ? `${batch.failedFiles} failed` : "Stopped"}</span> : done ? <span className="text-pylon-green">Done</span> : (
          <>
            {batch.bps > 0 && <span>{formatSpeed(batch.bps)}</span>}
            <span className="tabular w-9 text-right">{pct.toFixed(0)}%</span>
            <button onClick={() => cancelBatch(batch.batchId)} title="Cancel folder transfer" className="rounded p-0.5 text-slate-500 hover:bg-void-600 hover:text-pylon-red">
              <X size={12} />
            </button>
          </>
        )}
      </span>
    </div>
  );
}

import { ArrowDown, ArrowUp, Pause, Play, RotateCcw, ShieldCheck, X } from "lucide-react";
import { TransferRecord } from "../../types";
import { useTransferStore, isFailed } from "../../stores/transferStore";
import { formatBytes, formatETA, formatSpeed } from "../../lib/format";
import { basename } from "../../lib/path";
import { IconButton } from "../ui/primitives";
import { toast } from "../../stores/toastStore";
import { errMsg } from "../../lib/format";

export function TransferRow({ t, dense = false }: { t: TransferRecord; dense?: boolean }) {
  const { progress, speedBps, cancelTransfer, pauseTransfer, resumeTransfer, retryTransfer } = useTransferStore();
  const p = progress[t.id];
  const failed = isFailed(t.state);
  const done = t.state === "completed";
  const cancelled = t.state === "cancelled";
  const running = t.state === "running";
  const paused = t.state === "paused";
  const total = t.total_bytes || p?.total_bytes || 0;
  const moved = t.transferred_bytes || p?.transferred_bytes || 0;
  const pct = done ? 100 : total > 0 ? Math.min(100, (moved / total) * 100) : 0;
  const name = basename(t.direction === "upload" ? t.local_path : t.remote_path);
  const dest = t.direction === "upload" ? t.remote_path : t.local_path;
  const bps = speedBps[t.id] ?? 0;
  const failMsg = failed ? (t.state as { failed: string }).failed.replace(/^Transfer error:\s*/, "") : "";

  const bar = failed ? "bg-pylon-red" : done ? "bg-pylon-green" : paused ? "bg-pylon-amber" : cancelled ? "bg-slate-600" : "bg-pylon-cyan";
  const status = failed ? (
    <span className="truncate text-pylon-red" title={failMsg}>{failMsg}</span>
  ) : done ? (
    <span className="flex items-center gap-1 text-slate-400">
      {t.checksum_verified ? <><ShieldCheck size={11} className="text-pylon-green" /> Verified</> : "Done"}
    </span>
  ) : cancelled ? <span>Cancelled</span> : paused ? <span className="text-pylon-amber">Paused</span> : (
    <span className="tabular">{bps > 0 ? `${formatSpeed(bps)} · ${formatETA(p?.eta_secs ?? null)} left` : "Starting…"}</span>
  );

  return (
    <div className={`group rounded-md px-2.5 ${dense ? "py-2" : "py-2.5"} hover:bg-void-700/50`}>
      <div className="flex items-center gap-2">
        {t.direction === "upload" ? <ArrowUp size={13} className="shrink-0 text-pylon-cyan" /> : <ArrowDown size={13} className="shrink-0 text-pylon-violet" />}
        <span className="min-w-0 flex-1 truncate text-[13px] text-slate-200" title={`${name}\n→ ${dest}`}>{name}</span>
        <span className="tabular shrink-0 text-[11px] text-slate-500">{done ? formatBytes(total) : `${formatBytes(moved)} / ${formatBytes(total)}`}</span>
        <div className="flex shrink-0 items-center">
          {running && <IconButton className="h-6 w-6" title="Pause" onClick={() => pauseTransfer(t.id)}><Pause size={12} /></IconButton>}
          {paused && <IconButton className="h-6 w-6" title="Resume" onClick={() => resumeTransfer(t.id)}><Play size={12} /></IconButton>}
          {(failed || cancelled) && (
            <IconButton className="h-6 w-6" title={failed ? "Retry — resumes from where it stopped" : "Start again"} onClick={() => retryTransfer(t.id).catch((e) => toast.error("Retry failed", errMsg(e)))}>
              <RotateCcw size={12} />
            </IconButton>
          )}
          {(running || paused || t.state === "queued") && <IconButton className="h-6 w-6" tone="danger" title="Cancel" onClick={() => cancelTransfer(t.id)}><X size={13} /></IconButton>}
        </div>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-void-600">
        <div className={`h-full rounded-full transition-[width] duration-200 ${bar}`} style={{ width: `${failed ? 100 : pct}%` }} />
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
        <span className="min-w-0 flex-1 truncate">{status}</span>
        {!dense && <span className="hidden max-w-[45%] truncate font-mono lg:inline" title={dest}>{dest}</span>}
        {(running || paused) && <span className="tabular shrink-0">{pct.toFixed(0)}%</span>}
      </div>
    </div>
  );
}

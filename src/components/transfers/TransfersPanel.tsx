import { useEffect, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { useTransferStore, isActive, isFailed } from "../../stores/transferStore";
import { TransferRow } from "./TransferRow";
import { Button, Segmented } from "../ui/primitives";
import { formatSpeed } from "../../lib/format";

type Filter = "all" | "active" | "failed" | "done";

export function TransfersPanel() {
  const { transfers, speedBps, fetchTransfers, clearCompleted, cancelTransfer } = useTransferStore();
  const [filter, setFilter] = useState<Filter>("all");
  useEffect(() => { fetchTransfers().catch(() => {}); }, []);

  const active = transfers.filter((t) => isActive(t.state));
  const failed = transfers.filter((t) => isFailed(t.state));
  const list = transfers.filter((t) =>
    filter === "all" ? true : filter === "active" ? isActive(t.state) : filter === "failed" ? isFailed(t.state) : t.state === "completed",
  );
  const bps = active.reduce((a, t) => a + (speedBps[t.id] ?? 0), 0);

  return (
    <div className="flex h-full flex-col bg-void-800">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-void-600 bg-void-900 px-4">
        <h1 className="text-[14px] font-semibold text-slate-100">Transfers</h1>
        <span className="text-xs text-slate-500">
          {active.length ? `${active.length} active${bps ? ` · ${formatSpeed(bps)}` : ""}` : "Idle"}
          {failed.length ? ` · ${failed.length} failed` : ""}
        </span>
        <div className="flex-1" />
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "active", label: `Active${active.length ? ` ${active.length}` : ""}` },
            { value: "failed", label: `Failed${failed.length ? ` ${failed.length}` : ""}` },
            { value: "done", label: "Completed" },
          ]}
        />
        {active.length > 1 && <Button size="sm" variant="danger-ghost" onClick={() => active.forEach((t) => cancelTransfer(t.id))}>Cancel all</Button>}
        <Button size="sm" onClick={clearCompleted} disabled={transfers.length === active.length}>Clear finished</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl p-3">
          {list.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-24 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-void-600 bg-void-700 text-slate-500"><ArrowLeftRight size={18} /></div>
              <p className="text-[13px] text-slate-300">{filter === "all" ? "No transfers yet" : "Nothing here"}</p>
              <p className="text-xs text-slate-500">Uploads and downloads appear here with speed, progress and checksum status.</p>
            </div>
          ) : (
            <div className="space-y-0.5">{list.map((t) => <TransferRow key={t.id} t={t} />)}</div>
          )}
        </div>
      </div>
    </div>
  );
}

import { ArrowLeftRight, KeyRound, Lock, RefreshCw } from "lucide-react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useTransferStore, isActive } from "../../stores/transferStore";
import { useSyncStore } from "../../stores/syncStore";
import { useUiStore } from "../../stores/uiStore";
import { formatSpeed } from "../../lib/format";

export function StatusBar() {
  const { connections, activeSessionId, vaultUnlocked } = useConnectionStore();
  const { transfers, speedBps } = useTransferStore();
  const syncs = useSyncStore((s) => s.syncs);
  const { setTransferDrawer, setActiveTab, setVaultModal } = useUiStore();

  const conn = connections.find((c) => c.id === activeSessionId);
  const active = transfers.filter((t) => isActive(t.state));
  const totalBytes = active.reduce((a, t) => a + (t.total_bytes || 0), 0);
  const doneBytes = active.reduce((a, t) => a + (t.transferred_bytes || 0), 0);
  const pct = totalBytes > 0 ? (doneBytes / totalBytes) * 100 : 0;
  const bps = active.reduce((a, t) => a + (speedBps[t.id] ?? 0), 0);
  const watching = syncs.filter((s) => s.active).length;

  return (
    <div className="relative flex h-7 shrink-0 select-none items-center gap-4 border-t border-void-600 bg-void-900 px-3 text-[11.5px] text-slate-500">
      {conn ? (
        <div className="flex min-w-0 items-center gap-2" title={conn.server_fingerprint ?? undefined}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${typeof conn.state === "object" ? "bg-pylon-red" : "bg-pylon-green"}`} />
          <span className="truncate text-slate-300">{conn.username}@{conn.host}{conn.port !== 22 ? `:${conn.port}` : ""}</span>
          {conn.server_key_type && <span className="hidden truncate md:inline">{conn.server_key_type}</span>}
          {conn.server_version && <span className="hidden truncate lg:inline">{conn.server_version.replace(/^SSH-2\.0-/, "")}</span>}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full border border-slate-600" />
          Not connected
        </div>
      )}

      <div className="flex-1" />

      {active.length > 0 && (
        <button onClick={() => setTransferDrawer(true)} className="flex items-center gap-2 rounded px-1.5 py-0.5 hover:bg-void-700 hover:text-slate-200" title="Show transfers">
          <ArrowLeftRight size={12} className="text-pylon-cyan" />
          <span className="text-slate-300">{active.length} transfer{active.length > 1 ? "s" : ""}</span>
          <span className="tabular">{pct.toFixed(0)}%</span>
          {bps > 0 && <span className="tabular text-pylon-cyan">{formatSpeed(bps)}</span>}
        </button>
      )}
      {watching > 0 && (
        <button onClick={() => setActiveTab("sync")} className="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-void-700 hover:text-slate-200" title="Sync watchers">
          <RefreshCw size={11} />
          {watching} watching
        </button>
      )}
      <button onClick={() => setVaultModal(true)} className="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-void-700 hover:text-slate-200" title="ZVault">
        {vaultUnlocked ? <KeyRound size={11} className="text-pylon-amber" /> : <Lock size={11} />}
        {vaultUnlocked ? "Vault unlocked" : "Vault locked"}
      </button>

      {active.length > 0 && (
        <div className="absolute inset-x-0 -top-px h-px bg-void-600">
          <div className="h-full bg-pylon-cyan transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

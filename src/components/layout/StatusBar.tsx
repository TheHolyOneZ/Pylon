import { Activity, Shield, Wifi, WifiOff } from "lucide-react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useTransferStore } from "../../stores/transferStore";
import { useUiStore } from "../../stores/uiStore";
import { formatBytes, formatSpeed } from "../../lib/format";

export function StatusBar() {
  const { connections, activeSessionId } = useConnectionStore();
  const { transfers, speedBps } = useTransferStore();
  const { toggleTransferDrawer } = useUiStore();

  const activeConn = connections.find((c) => c.id === activeSessionId);
  const runningTransfers = transfers.filter((t) => t.state === "running");
  const stripping = runningTransfers.filter((t) => t.strip_metadata);


  const totalBps = Object.values(speedBps).reduce((a, b) => a + b, 0);


  const avgPct = runningTransfers.length > 0
    ? runningTransfers.reduce((acc, t) => {
        const pct = t.total_bytes > 0 ? (t.transferred_bytes / t.total_bytes) * 100 : 0;
        return acc + pct;
      }, 0) / runningTransfers.length
    : 0;

  return (
    <div className="relative flex items-center h-6 bg-void-900 border-t border-void-600 px-4 text-xs text-slate-500 gap-5 shrink-0 select-none">
      {}
      <div className="flex items-center gap-1.5">
        {activeConn ? (
          <>
            <Wifi size={11} className="text-pylon-green" />
            <span className="text-slate-400">{activeConn.host}</span>
            <span className="text-slate-600">·</span>
            <span>↑ {formatBytes(activeConn.bytes_sent)}</span>
            <span>↓ {formatBytes(activeConn.bytes_received)}</span>
          </>
        ) : (
          <>
            <WifiOff size={11} />
            <span>Not connected</span>
          </>
        )}
      </div>

      {}
      {runningTransfers.length > 0 && (
        <button
          onClick={toggleTransferDrawer}
          className="flex items-center gap-1.5 hover:text-slate-300 transition-colors"
          title="Open transfer drawer"
        >
          <Activity size={11} className="text-pylon-cyan" />
          <span className="text-pylon-cyan">{formatSpeed(totalBps)}</span>
          <span>{runningTransfers.length} transfer{runningTransfers.length > 1 ? "s" : ""}</span>
        </button>
      )}

      {}
      {stripping.length > 0 && (
        <div className="flex items-center gap-1">
          <Shield size={10} className="text-pylon-amber" />
          <span className="text-pylon-amber">{stripping.length} stripping</span>
        </div>
      )}

      <div className="flex-1" />

      {}
      {activeConn?.server_key_type && (
        <span className="text-slate-600">{activeConn.server_key_type}</span>
      )}

      {}
      {runningTransfers.length > 0 && (
        <div
          className="absolute bottom-0 left-0 h-0.5 bg-pylon-cyan/60 transition-all duration-300"
          style={{ width: `${avgPct}%` }}
        />
      )}
    </div>
  );
}

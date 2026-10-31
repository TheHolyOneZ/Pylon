import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Plus, Search, X } from "lucide-react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";
import { isMac, modKey } from "../../lib/path";
import { PylonMark } from "../ui/primitives";

function MaximizeIcon({ maximized }: { maximized: boolean }) {
  return maximized ? (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="3" y="1" width="8" height="8" rx="1" />
      <path d="M1 3.5v6A1.5 1.5 0 0 0 2.5 11h6" />
    </svg>
  ) : (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="1.5" y="1.5" width="9" height="9" rx="1" />
    </svg>
  );
}

export function TitleBar() {
  const { connections, activeSessionId, setActiveSession, disconnectFromServer } = useConnectionStore();
  const { setActiveTab, setConnectModal, setCommandPalette, activeTab } = useUiStore();
  const [maximized, setMaximized] = useState(false);
  const mac = isMac();

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    win.isMaximized().then(setMaximized).catch(() => {});
    win.onResized(() => win.isMaximized().then(setMaximized).catch(() => {})).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  const win = getCurrentWindow();

  return (
    <div data-tauri-drag-region className="flex h-10 shrink-0 select-none items-center border-b border-void-600 bg-void-900">
      <div data-tauri-drag-region className={`pointer-events-none flex shrink-0 items-center gap-2 ${mac ? "pl-[78px]" : "pl-3.5"} pr-3`}>
        <PylonMark size={16} className="text-pylon-cyan" />
        <span className="text-[13px] font-semibold tracking-tight text-slate-200">Pylon</span>
      </div>

      <div className="flex h-full min-w-0 items-center gap-0.5 overflow-x-auto py-1.5" style={{ scrollbarWidth: "none" }}>
        {connections.map((conn) => {
          const isActive = conn.id === activeSessionId;
          const broken = typeof conn.state === "object";
          return (
            <div
              key={conn.id}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                setActiveSession(conn.id);
                if (activeTab === "settings" || activeTab === "transfers") setActiveTab("files");
              }}
              onAuxClick={(e) => { if (e.button === 1) disconnectFromServer(conn.id); }}
              title={`${conn.username}@${conn.host}:${conn.port}${broken ? " — connection lost" : ""}\nMiddle-click to disconnect`}
              className={`group flex h-full max-w-[200px] shrink-0 items-center gap-2 rounded-md pl-2.5 pr-1 text-xs transition-colors ${
                isActive ? "bg-void-700 text-slate-100" : "text-slate-400 hover:bg-void-800 hover:text-slate-200"
              }`}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${broken ? "bg-pylon-red" : "bg-pylon-green"}`} />
              <span className="truncate">{conn.label}</span>
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => disconnectFromServer(conn.id)}
                title="Disconnect"
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-void-500 hover:text-slate-100 ${isActive ? "" : "opacity-0 group-hover:opacity-100"}`}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        <button
          onClick={() => setConnectModal(true)}
          title={`New connection (${modKey()}+N)`}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-void-700 hover:text-slate-200"
        >
          <Plus size={14} />
        </button>
      </div>

      <div data-tauri-drag-region className="h-full min-w-[24px] flex-1" />

      <button
        onClick={() => setCommandPalette(true)}
        className="mr-2 flex h-7 w-[220px] shrink items-center gap-2 rounded-md border border-void-600 bg-void-950/50 px-2.5 text-xs text-slate-500 hover:border-void-500 hover:text-slate-300"
      >
        <Search size={13} />
        <span className="flex-1 text-left">Search commands…</span>
        <span className="kbd">{modKey()} K</span>
      </button>

      {!mac && (
        <div className="flex h-full shrink-0 items-center">
          <button onClick={() => win.minimize()} className="flex h-full w-11 items-center justify-center text-slate-400 hover:bg-void-700 hover:text-slate-100" title="Minimize">
            <Minus size={14} />
          </button>
          <button onClick={() => win.toggleMaximize()} className="flex h-full w-11 items-center justify-center text-slate-400 hover:bg-void-700 hover:text-slate-100" title={maximized ? "Restore" : "Maximize"}>
            <MaximizeIcon maximized={maximized} />
          </button>
          <button onClick={() => win.close()} className="flex h-full w-11 items-center justify-center text-slate-400 hover:bg-[#c42b1c] hover:text-white" title="Close">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

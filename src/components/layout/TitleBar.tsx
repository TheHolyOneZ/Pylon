import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, X } from "lucide-react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";

function MaximizeIcon({ maximized }: { maximized: boolean }) {
  return maximized ? (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="1" width="8" height="8" rx="0.5" />
      <path d="M1 3v7a1 1 0 001 1h7" />
    </svg>
  ) : (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="10" height="10" rx="0.5" />
    </svg>
  );
}

const winMinimize       = () => invoke("plugin:window|minimize");
const winToggleMaximize = () => invoke("plugin:window|toggle_maximize");
const winClose          = () => invoke("plugin:window|close");

export function TitleBar() {
  const { connections, activeSessionId, setActiveSession, disconnectFromServer } = useConnectionStore();
  const { setActiveTab } = useUiStore();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    win.isMaximized().then(setMaximized);
    win.onResized(() => win.isMaximized().then(setMaximized)).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  return (

    <div
      data-tauri-drag-region
      className="flex items-center h-10 bg-void-900 border-b border-void-600 select-none shrink-0"
    >
      {}
      <div className="flex items-center gap-2 px-4 mr-2 shrink-0 pointer-events-none">
        <img src="/pylon-icon.png" alt="Pylon" className="w-4 h-4 rounded-sm opacity-90" />
        <span className="text-[13px] font-semibold tracking-tight text-slate-200">pylon</span>
        <span className="px-1.5 py-px rounded bg-void-700 border border-void-600 text-[9px] font-mono text-slate-500 tracking-wider">v0.2</span>
      </div>

      {}
      <div className="flex items-center gap-1 min-w-0 overflow-hidden max-w-[55%]">
        {connections.map((conn) => {
          const isActive = conn.id === activeSessionId;
          return (
            <button
              key={conn.id}
              onClick={() => { setActiveSession(conn.id); setActiveTab("files"); }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs border shrink-0 transition-all group ${
                isActive
                  ? "bg-pylon-cyan/10 border-pylon-cyan/30 text-pylon-cyan"
                  : "bg-void-700 border-void-500 text-slate-400 hover:text-slate-200 hover:bg-void-600"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-pylon-cyan animate-pulse" : "bg-pylon-green animate-pulse"}`} />
              <span className="truncate max-w-28">{conn.label}</span>
              <span
                onClick={(e) => { e.stopPropagation(); disconnectFromServer(conn.id); }}
                className="opacity-0 group-hover:opacity-100 hover:text-pylon-red transition-all ml-0.5 cursor-pointer"
              >
                <X size={10} />
              </span>
            </button>
          );
        })}
      </div>

      {}
      <div className="flex-1" data-tauri-drag-region />

      {}
      <div className="flex items-center shrink-0">
        <button onClick={winMinimize}
          className="w-10 h-10 flex items-center justify-center hover:bg-void-700 text-slate-400 hover:text-white transition-colors"
          title="Minimize">
          <Minus size={14} />
        </button>
        <button onClick={winToggleMaximize}
          className="w-10 h-10 flex items-center justify-center hover:bg-void-700 text-slate-400 hover:text-white transition-colors"
          title={maximized ? "Restore" : "Maximize"}>
          <MaximizeIcon maximized={maximized} />
        </button>
        <button onClick={winClose}
          className="w-10 h-10 flex items-center justify-center hover:bg-red-900/70 text-slate-400 hover:text-red-300 transition-colors"
          title="Close">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

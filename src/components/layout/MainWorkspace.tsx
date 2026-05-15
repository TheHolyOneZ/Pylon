import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Activity, Terminal as TermIcon } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { FileExplorer } from "../files/FileExplorer";
import { ActivityLog } from "../files/ActivityLog";
import { TerminalPane } from "../terminal/TerminalPane";
import { TransfersPanel } from "../transfers/TransfersPanel";
import { SyncPanel } from "../sync/SyncPanel";
import { SettingsPanel } from "../settings/SettingsPanel";

function BottomModeBar() {
  const { bottomMode, setBottomMode } = useUiStore();

  const modes = [
    { id: "terminal" as const, label: "Terminal", icon: <TermIcon size={10} /> },
    { id: "log"      as const, label: "Log",      icon: <Activity size={10} /> },
    { id: "split"    as const, label: "Split",    icon: <span className="text-[9px] font-mono leading-none">⊞</span> },
    { id: "hidden"   as const, label: "Hide",     icon: <span className="text-[9px] leading-none">✕</span> },
  ];

  return (
    <div className="flex items-center gap-0.5 px-2 h-6 bg-void-800 border-b border-void-600 shrink-0">
      {modes.map((m) => (
        <button
          key={m.id}
          onClick={() => setBottomMode(m.id)}
          title={m.label}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-all ${
            bottomMode === m.id
              ? "bg-pylon-cyan/10 text-pylon-cyan border border-pylon-cyan/20"
              : "text-slate-600 hover:text-slate-400 hover:bg-void-700"
          }`}
        >
          {m.icon}
          <span>{m.label}</span>
        </button>
      ))}
    </div>
  );
}

export function MainWorkspace() {
  const { activeTab, bottomMode } = useUiStore();

  if (activeTab === "transfers") {
    return <div className="flex-1 overflow-hidden"><TransfersPanel /></div>;
  }
  if (activeTab === "sync") {
    return <div className="flex-1 overflow-hidden"><SyncPanel /></div>;
  }
  if (activeTab === "settings") {
    return <div className="flex-1 overflow-hidden"><SettingsPanel /></div>;
  }
  if (activeTab === "terminal") {
    return <div className="flex-1 overflow-hidden"><TerminalPane /></div>;
  }

  const showBottom = bottomMode !== "hidden";

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <PanelGroup direction="vertical" className="flex-1">
        <Panel defaultSize={showBottom ? 62 : 100} minSize={30}>
          <FileExplorer />
        </Panel>

        {showBottom && (
          <>
            <PanelResizeHandle className="h-px bg-void-600 hover:bg-pylon-cyan/40 transition-colors cursor-row-resize" />
            <Panel defaultSize={38} minSize={15}>
              {}
              <BottomModeBar />
              <div className="flex-1 overflow-hidden" style={{ height: "calc(100% - 1.5rem)" }}>
                {bottomMode === "terminal" && <TerminalPane />}
                {bottomMode === "log"      && <ActivityLog />}
                {bottomMode === "split"    && (
                  <PanelGroup direction="horizontal" className="h-full">
                    <Panel defaultSize={55} minSize={20}>
                      <TerminalPane />
                    </Panel>
                    <PanelResizeHandle className="w-px bg-void-600 hover:bg-pylon-cyan/40 transition-colors cursor-col-resize" />
                    <Panel defaultSize={45} minSize={20}>
                      <ActivityLog />
                    </Panel>
                  </PanelGroup>
                )}
              </div>
            </Panel>
          </>
        )}
      </PanelGroup>

      {}
      {!showBottom && <BottomModeBar />}
    </div>
  );
}

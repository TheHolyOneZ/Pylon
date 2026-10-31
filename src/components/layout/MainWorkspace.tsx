import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Activity, ChevronDown, Columns2, SquareTerminal } from "lucide-react";
import { useUiStore, BottomMode } from "../../stores/uiStore";
import { FileExplorer } from "../files/FileExplorer";
import { ActivityLog } from "../files/ActivityLog";
import { TerminalPane } from "../terminal/TerminalPane";
import { TransfersPanel } from "../transfers/TransfersPanel";
import { SyncPanel } from "../sync/SyncPanel";
import { SettingsPanel } from "../settings/SettingsPanel";

function BottomTabs({ collapsed }: { collapsed: boolean }) {
  const { bottomMode, setBottomMode } = useUiStore();
  const modes: { id: BottomMode; label: string; icon: React.ReactNode }[] = [
    { id: "terminal", label: "Terminal", icon: <SquareTerminal size={13} /> },
    { id: "log", label: "Activity", icon: <Activity size={13} /> },
    { id: "split", label: "Both", icon: <Columns2 size={13} /> },
  ];
  return (
    <div className="flex h-8 shrink-0 items-center gap-0.5 border-t border-void-600 bg-void-900 px-1.5">
      {modes.map((m) => {
        const on = !collapsed && bottomMode === m.id;
        return (
          <button
            key={m.id}
            onClick={() => setBottomMode(m.id)}
            className={`flex h-6 items-center gap-1.5 rounded-md px-2 text-xs transition-colors ${on ? "bg-void-700 text-slate-100" : "text-slate-500 hover:bg-void-800 hover:text-slate-200"}`}
          >
            {m.icon}
            {m.label}
          </button>
        );
      })}
      <div className="flex-1" />
      {!collapsed && (
        <button onClick={() => setBottomMode("hidden")} title="Hide panel" className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-void-700 hover:text-slate-200">
          <ChevronDown size={14} />
        </button>
      )}
    </div>
  );
}

const handle = "relative h-px bg-void-600 transition-colors hover:bg-pylon-cyan/60 data-[resize-handle-active]:bg-pylon-cyan before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-['']";

export function MainWorkspace() {
  const { activeTab, bottomMode } = useUiStore();

  if (activeTab === "transfers") return <div className="min-w-0 flex-1 overflow-hidden"><TransfersPanel /></div>;
  if (activeTab === "sync") return <div className="min-w-0 flex-1 overflow-hidden"><SyncPanel /></div>;
  if (activeTab === "settings") return <div className="min-w-0 flex-1 overflow-hidden"><SettingsPanel /></div>;
  if (activeTab === "terminal") return <div className="min-w-0 flex-1 overflow-hidden"><TerminalPane /></div>;

  const showBottom = bottomMode !== "hidden";
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <PanelGroup direction="vertical" autoSaveId="pylon-files-vertical" className="flex-1">
        <Panel id="files" order={1} defaultSize={64} minSize={25}>
          <FileExplorer />
        </Panel>
        {showBottom && (
          <>
            <PanelResizeHandle className={handle} />
            <Panel id="bottom" order={2} defaultSize={36} minSize={12}>
              <div className="flex h-full flex-col">
                <BottomTabs collapsed={false} />
                <div className="min-h-0 flex-1 overflow-hidden">
                  {bottomMode === "terminal" && <TerminalPane />}
                  {bottomMode === "log" && <ActivityLog />}
                  {bottomMode === "split" && (
                    <PanelGroup direction="horizontal" autoSaveId="pylon-bottom-split" className="h-full">
                      <Panel id="bt" order={1} defaultSize={60} minSize={25}><TerminalPane /></Panel>
                      <PanelResizeHandle className="w-px bg-void-600 hover:bg-pylon-cyan/60" />
                      <Panel id="bl" order={2} defaultSize={40} minSize={20}><ActivityLog /></Panel>
                    </PanelGroup>
                  )}
                </div>
              </div>
            </Panel>
          </>
        )}
      </PanelGroup>
      {!showBottom && <BottomTabs collapsed />}
    </div>
  );
}

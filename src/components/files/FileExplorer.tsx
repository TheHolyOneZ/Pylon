import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import { LocalPane } from "./LocalPane";
import { RemotePane } from "./RemotePane";

export function FileExplorer() {
  return (
    <div className="h-full">
      <PanelGroup direction="horizontal" autoSaveId="pylon-files-horizontal">
        <Panel id="local" order={1} defaultSize={50} minSize={22}>
          <LocalPane />
        </Panel>
        <PanelResizeHandle className="relative w-px bg-void-600 transition-colors hover:bg-pylon-cyan/60 data-[resize-handle-active]:bg-pylon-cyan before:absolute before:-inset-x-1.5 before:inset-y-0 before:content-['']" />
        <Panel id="remote" order={2} defaultSize={50} minSize={22}>
          <RemotePane />
        </Panel>
      </PanelGroup>
    </div>
  );
}

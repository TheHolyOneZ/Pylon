import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import { LocalPane } from "./LocalPane";
import { RemotePane } from "./RemotePane";

export function FileExplorer() {
  return (
    <div className="h-full">
      <PanelGroup direction="horizontal">
        <Panel defaultSize={50} minSize={25}>
          <LocalPane />
        </Panel>
        <PanelResizeHandle className="w-px bg-void-600 hover:bg-pylon-violet/40 transition-colors cursor-col-resize" />
        <Panel defaultSize={50} minSize={25}>
          <RemotePane />
        </Panel>
      </PanelGroup>
    </div>
  );
}

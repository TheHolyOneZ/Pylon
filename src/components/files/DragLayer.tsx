import { createPortal } from "react-dom";
import { ArrowDownToLine, ArrowUpFromLine, File, Folder, MoveRight } from "lucide-react";
import { useDragStore } from "../../stores/dragStore";

export function DragLayer() {
  const { active, items, x, y, source, overPane, overDir } = useDragStore();
  if (!active || items.length === 0) return null;
  const first = items[0];
  const cross = overPane && overPane !== source;
  const verb = cross ? (overPane === "remote" ? "Upload" : "Download") : overDir ? "Move" : null;
  const VerbIcon = cross ? (overPane === "remote" ? ArrowUpFromLine : ArrowDownToLine) : MoveRight;
  return createPortal(
    <div className="pointer-events-none fixed z-[10000]" style={{ left: x + 14, top: y + 12 }}>
      <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs shadow-popover ${verb ? "border-pylon-cyan/40 bg-void-800 text-slate-100" : "border-void-500 bg-void-800/95 text-slate-400"}`}>
        {first?.is_dir ? <Folder size={13} className="text-pylon-violet" /> : <File size={13} className="text-slate-400" />}
        <span className="max-w-[220px] truncate">{items.length > 1 ? `${items.length} items` : first?.name}</span>
        {verb && (
          <span className="flex items-center gap-1 rounded bg-pylon-cyan/15 px-1.5 py-0.5 text-[11px] font-medium text-pylon-cyan">
            <VerbIcon size={11} /> {verb}{overDir ? ` → ${overDir.split("/").pop()}` : ""}
          </span>
        )}
      </div>
    </div>,
    document.body,
  );
}

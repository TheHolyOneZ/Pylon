import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { ChevronRight, HardDrive, Home, Star, StarOff } from "lucide-react";
import { useFileStore } from "../../stores/fileStore";
import { localCrumbs, remoteCrumbs } from "../../lib/path";
import * as api from "../../lib/tauri";
import { ContextMenu, ContextMenuEntry } from "./ContextMenu";

interface Props {
  path: string;
  side: "local" | "remote";
  onNavigate: (path: string) => void;
  homePath?: string | null;
  editSignal?: number;
}

export function PathBreadcrumb({ path, side, onNavigate, homePath, editSignal }: Props) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(path);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const trail = useRef<HTMLDivElement>(null);
  const { bookmarks, addBookmark, removeBookmark } = useFileStore();

  const sideBookmarks = bookmarks.filter((b) => b.side === side);
  const current = sideBookmarks.find((b) => b.path === path);
  const crumbs = side === "local" ? localCrumbs(path) : remoteCrumbs(path);

  const lastSignal = useRef(editSignal);
  useEffect(() => {
    if (editSignal && editSignal !== lastSignal.current) startEdit();
    lastSignal.current = editSignal;
  }, [editSignal]);

  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const el = trail.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
    const update = () => setClipped(el.scrollLeft > 1);
    update();
    const ro = new ResizeObserver(() => { el.scrollLeft = el.scrollWidth; update(); });
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener("scroll", update); };
  }, [path, editing]);

  function startEdit() {
    setEditVal(path);
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  }

  function commit() {
    const v = editVal.trim();
    setEditing(false);
    if (v && v !== path) onNavigate(v);
  }

  async function openBookmarks(e: React.MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const items: ContextMenuEntry[] = [
      current
        ? { label: "Remove bookmark", icon: <StarOff size={13} />, onClick: () => removeBookmark(current.id) }
        : { label: "Bookmark this folder", icon: <Star size={13} />, onClick: () => addBookmark(crumbs.at(-1)?.label || path, path, side) },
    ];
    if (homePath) items.push({ label: "Home", icon: <Home size={13} />, onClick: () => onNavigate(homePath) });
    if (side === "local") {
      const drives = await api.getLocalDrives().catch(() => []);
      if (drives.length > 1 || (drives[0] && drives[0].path !== "/")) {
        items.push({ separator: true });
        for (const d of drives) items.push({ label: d.name, icon: <HardDrive size={13} />, onClick: () => onNavigate(d.path.replace(/\\/g, "/")) });
      }
    }
    if (sideBookmarks.length) {
      items.push({ separator: true });
      for (const b of sideBookmarks) items.push({ label: b.label, icon: <Star size={13} className="fill-pylon-amber/60 text-pylon-amber" />, onClick: () => onNavigate(b.path) });
    }
    setMenu({ x: r.left, y: r.bottom + 4, items });
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {editing ? (
        <input
          ref={inputRef}
          value={editVal}
          onChange={(e) => setEditVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          spellCheck={false}
          className="h-7 min-w-0 flex-1 rounded-md border border-pylon-cyan/60 bg-void-950 px-2 font-mono text-xs text-slate-100 outline-none"
        />
      ) : (
        <div
          ref={trail}
          onDoubleClick={startEdit}
          onClick={(e) => { if (e.target === e.currentTarget) startEdit(); }}
          title="Click empty space or press Ctrl+L to type a path"
          className="no-scrollbar flex h-7 min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap rounded-md border border-void-600 bg-void-950/40 px-1 hover:border-void-500"
          style={{
            scrollbarWidth: "none",
            ...(clipped ? { maskImage: "linear-gradient(to right, transparent, #000 28px)", WebkitMaskImage: "linear-gradient(to right, transparent, #000 28px)" } : {}),
          }}
        >
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <span key={c.path} className="flex shrink-0 items-center">
                {i > 0 && <ChevronRight size={12} className="shrink-0 text-slate-600" />}
                <button
                  onClick={() => !last && onNavigate(c.path)}
                  className={`rounded px-1.5 py-0.5 text-xs ${last ? "font-medium text-slate-100" : "text-slate-400 hover:bg-void-700 hover:text-slate-100"}`}
                >
                  {c.label}
                </button>
              </span>
            );
          })}
        </div>
      )}
      <button
        onClick={openBookmarks}
        title="Bookmarks & locations"
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-void-700 ${current ? "text-pylon-amber" : "text-slate-500 hover:text-slate-200"}`}
      >
        <Star size={13} className={current ? "fill-pylon-amber" : ""} />
      </button>
      <AnimatePresence>{menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}</AnimatePresence>
    </div>
  );
}

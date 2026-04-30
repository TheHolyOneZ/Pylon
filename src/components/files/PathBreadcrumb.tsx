import { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { BookmarkCheck, BookmarkPlus, ChevronRight, Star, X } from "lucide-react";
import { useFileStore } from "../../stores/fileStore";

interface Props {
  path: string;
  side: "local" | "remote";
  onNavigate: (path: string) => void;
}

export function PathBreadcrumb({ path, side, onNavigate }: Props) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(path);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ x: 0, y: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const starBtnRef = useRef<HTMLButtonElement>(null);
  const { bookmarks, addBookmark, removeBookmark } = useFileStore();

  const relevantBookmarks = bookmarks.filter((b) => b.side === side);
  const currentBookmark = relevantBookmarks.find((b) => b.path === path);
  const isBookmarked = !!currentBookmark;

  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  const crumbs = [
    { label: "/", path: "/" },
    ...parts.map((p, i) => ({ label: p, path: "/" + parts.slice(0, i + 1).join("/") })),
  ];

  function startEdit() {
    setEditVal(path);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitEdit() {
    const v = editVal.trim();
    if (v) onNavigate(v);
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") setEditing(false);
  }

  function toggleBookmark() {
    if (isBookmarked) {
      removeBookmark(currentBookmark.id);
    } else {
      const label = parts[parts.length - 1] || "/";
      addBookmark(label, path, side);
    }
  }

  function openDropdown() {
    if (starBtnRef.current) {
      const rect = starBtnRef.current.getBoundingClientRect();
      setDropdownPos({ x: rect.right, y: rect.bottom + 4 });
    }
    setShowBookmarks((v) => !v);
  }


  useEffect(() => {
    if (!showBookmarks) return;
    function handle(e: MouseEvent) {
      if (starBtnRef.current?.contains(e.target as Node)) return;
      setShowBookmarks(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [showBookmarks]);

  return (
    <div className="flex items-center gap-1 overflow-hidden relative">
      {editing ? (
        <input
          ref={inputRef}
          value={editVal}
          onChange={(e) => setEditVal(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          className="flex-1 min-w-0 bg-void-700 border border-pylon-cyan/40 rounded px-2 py-0 text-xs text-slate-100 outline-none font-mono"
          autoFocus
        />
      ) : (
        <button
          onClick={startEdit}
          title="Click to type a path"
          className="flex items-center gap-0.5 overflow-hidden min-w-0 flex-1"
        >
          {crumbs.map((crumb, i) => (
            <span key={crumb.path} className="flex items-center gap-0.5 shrink-0">
              {i > 0 && <ChevronRight size={10} className="text-slate-600" />}
              <span
                onClick={(e) => { e.stopPropagation(); onNavigate(crumb.path); }}
                className={`text-xs px-1 rounded hover:bg-void-600 transition-colors ${
                  i === crumbs.length - 1 ? "text-slate-300" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {crumb.label}
              </span>
            </span>
          ))}
        </button>
      )}

      {}
      <button
        ref={starBtnRef}
        onClick={openDropdown}
        title="Bookmarks"
        className={`flex items-center gap-0.5 p-1 rounded transition-colors shrink-0 ${
          isBookmarked
            ? "text-pylon-amber"
            : relevantBookmarks.length > 0
            ? "text-pylon-amber/50 hover:text-pylon-amber"
            : "text-slate-600 hover:text-slate-400"
        }`}
      >
        <Star size={11} className={isBookmarked ? "fill-pylon-amber" : ""} />
        {relevantBookmarks.length > 0 && (
          <span className="text-[9px] font-mono">{relevantBookmarks.length}</span>
        )}
      </button>

      {}
      {createPortal(
        <AnimatePresence>
          {showBookmarks && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.1 }}
              style={{ position: "fixed", right: window.innerWidth - dropdownPos.x, top: dropdownPos.y }}
              className="w-64 bg-void-800 border border-void-500 rounded-lg shadow-2xl z-[9999] overflow-hidden"
            >
              <button
                onClick={() => { toggleBookmark(); if (isBookmarked) setShowBookmarks(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors border-b border-void-600 ${
                  isBookmarked
                    ? "text-pylon-amber/80 hover:bg-pylon-red/10 hover:text-pylon-red"
                    : "text-pylon-cyan hover:bg-pylon-cyan/10"
                }`}
              >
                {isBookmarked ? <BookmarkCheck size={11} /> : <BookmarkPlus size={11} />}
                {isBookmarked ? "Remove bookmark for this path" : "Bookmark current path"}
              </button>

              {relevantBookmarks.length === 0 ? (
                <div className="px-3 py-3 text-center">
                  <p className="text-[11px] text-slate-600">No bookmarks saved yet</p>
                  <p className="text-[10px] text-slate-700 mt-0.5">Navigate to a folder and bookmark it above</p>
                </div>
              ) : (
                <div className="py-1 max-h-52 overflow-y-auto">
                  {relevantBookmarks.map((bm) => (
                    <div key={bm.id} className="flex items-center group">
                      <button
                        onClick={() => { onNavigate(bm.path); setShowBookmarks(false); }}
                        className="flex-1 flex flex-col text-left px-3 py-1.5 hover:bg-void-700 transition-colors min-w-0"
                      >
                        <span className={`text-xs font-medium truncate ${bm.path === path ? "text-pylon-amber" : "text-slate-200"}`}>
                          {bm.label}
                        </span>
                        <span className="text-[10px] text-slate-600 truncate font-mono">{bm.path}</span>
                      </button>
                      <button
                        onClick={() => removeBookmark(bm.id)}
                        className="opacity-0 group-hover:opacity-100 p-2 text-slate-600 hover:text-pylon-red transition-all shrink-0"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}

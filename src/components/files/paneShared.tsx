import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, ArrowUp, Eye, EyeOff, RefreshCw } from "lucide-react";
import type { TypeFilter } from "./PaneSearchBar";
import type { Row } from "./FileList";
import { useFileStore, Pane } from "../../stores/fileStore";
import { IconButton } from "../ui/primitives";
import { isMod, modKey } from "../../lib/path";

const EXT: Record<Exclude<TypeFilter, "all" | "folders">, Set<string>> = {
  code: new Set("ts tsx js jsx mjs cjs rs py go sh bash zsh fish php html htm css scss c cpp h hpp java rb swift kt dart lua r sql toml yaml yml json xml ini conf env vue svelte".split(" ")),
  images: new Set("png jpg jpeg gif webp svg bmp tiff tif ico heic heif avif".split(" ")),
  media: new Set("mp4 mkv mov avi wmv flv webm mp3 flac wav ogg aac m4a opus wma".split(" ")),
  docs: new Set("txt md mdx pdf docx doc xlsx xls pptx ppt odt rtf csv tsv epub".split(" ")),
  archives: new Set("zip tar gz tgz bz2 xz zst 7z rar dmg iso pkg deb rpm snap appimage".split(" ")),
};

export function matchesType(entry: { is_dir: boolean; name: string }, type: TypeFilter): boolean {
  if (type === "all") return true;
  if (type === "folders") return entry.is_dir;
  if (entry.is_dir) return false;
  const dot = entry.name.lastIndexOf(".");
  return EXT[type].has(dot > 0 ? entry.name.slice(dot + 1).toLowerCase() : "");
}

function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable || !!el.closest(".xterm");
}

export interface PaneKeyHandlers {
  rows: Row[];
  onOpen: (row: Row) => void;
  onUp: () => void;
  onDelete: () => void;
  onRename: (row: Row) => void;
  onRefresh: () => void;
  onFocusFilter: () => void;
  onEditPath: () => void;
  onNewFolder?: () => void;
  onTransfer?: () => void;
}

export function usePaneKeyboard(pane: Pane, h: PaneKeyHandlers) {
  const ref = useRef(h);
  ref.current = h;
  const typeahead = useRef({ text: "", at: 0 });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const fs = useFileStore.getState();
      if (fs.activePane !== pane || e.defaultPrevented || isTypingTarget(e.target)) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const { rows } = ref.current;
      const cursor = pane === "local" ? fs.cursorLocal : fs.cursorRemote;
      const idx = cursor ? rows.findIndex((r) => r.path === cursor) : -1;
      const move = (to: number, extend: boolean) => {
        if (!rows.length) return;
        const i = Math.max(0, Math.min(rows.length - 1, to));
        const row = rows[i];
        if (pane === "local") fs.selectLocal(row.path, i, extend, false);
        else fs.selectRemote(row.path, i, extend, false);
      };
      const mod = isMod(e);

      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        pane === "local" ? fs.selectAllLocal() : fs.selectAllRemote();
        return;
      }
      if ((mod && e.key.toLowerCase() === "f") || (e.key === "/" && !mod)) { e.preventDefault(); ref.current.onFocusFilter(); return; }
      if (mod && e.key.toLowerCase() === "l") { e.preventDefault(); ref.current.onEditPath(); return; }
      if (e.key === "F5" || (mod && e.key.toLowerCase() === "r")) { e.preventDefault(); ref.current.onRefresh(); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === "n") { e.preventDefault(); ref.current.onNewFolder?.(); return; }
      if (mod && e.key === "Enter") { e.preventDefault(); ref.current.onTransfer?.(); return; }

      switch (e.key) {
        case "ArrowDown": e.preventDefault(); move(idx < 0 ? 0 : idx + 1, e.shiftKey); return;
        case "ArrowUp":
          e.preventDefault();
          if (e.altKey) ref.current.onUp();
          else move(idx < 0 ? 0 : idx - 1, e.shiftKey);
          return;
        case "Home": e.preventDefault(); move(0, e.shiftKey); return;
        case "End": e.preventDefault(); move(rows.length - 1, e.shiftKey); return;
        case "PageDown": e.preventDefault(); move(idx + 15, e.shiftKey); return;
        case "PageUp": e.preventDefault(); move(idx - 15, e.shiftKey); return;
        case "Enter":
          if (idx >= 0) { e.preventDefault(); ref.current.onOpen(rows[idx]); }
          return;
        case "Backspace": e.preventDefault(); ref.current.onUp(); return;
        case "Delete": e.preventDefault(); ref.current.onDelete(); return;
        case "F2": if (idx >= 0) { e.preventDefault(); ref.current.onRename(rows[idx]); } return;
        case "Escape": fs.setSelection(pane, []); return;
        case "Tab":
          e.preventDefault();
          fs.setActivePane(pane === "local" ? "remote" : "local");
          return;
      }
      if (e.key.length === 1 && !mod && !e.altKey && /\S/.test(e.key)) {
        const now = Date.now();
        const t = typeahead.current;
        t.text = now - t.at > 700 ? e.key.toLowerCase() : t.text + e.key.toLowerCase();
        t.at = now;
        const hit = rows.findIndex((r) => r.name.toLowerCase().startsWith(t.text));
        if (hit >= 0) move(hit, false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pane]);
}

export function PaneHeader({
  pane, label, icon, accentClass, canBack, canForward, onBack, onForward, onUp, onRefresh, refreshing, children, actions,
}: {
  pane: Pane;
  label: string;
  icon: React.ReactNode;
  accentClass: string;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const { showHidden, toggleHidden, activePane } = useFileStore();
  const active = activePane === pane;
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-void-600 bg-void-900 px-2">
      <div className={`mr-1 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-semibold ${active ? accentClass : "text-slate-500"}`} title={`${label} — Tab switches panes`}>
        {icon}
        <span>{label}</span>
      </div>
      <IconButton onClick={onBack} disabled={!canBack} title="Back"><ArrowLeft size={14} /></IconButton>
      <IconButton onClick={onForward} disabled={!canForward} title="Forward"><ArrowRight size={14} /></IconButton>
      <IconButton onClick={onUp} title="Parent folder (Backspace)"><ArrowUp size={14} /></IconButton>
      {children}
      <IconButton onClick={toggleHidden} active={showHidden} title={showHidden ? "Hide hidden files" : "Show hidden files"}>
        {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
      </IconButton>
      {actions}
      <IconButton onClick={onRefresh} title={`Refresh (F5 / ${modKey()}+R)`}>
        <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
      </IconButton>
    </div>
  );
}

export function EmptyState({ icon, title, hint, action }: { icon: React.ReactNode; title: string; hint?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl border border-void-600 bg-void-800 text-slate-500">{icon}</div>
      <p className="text-[13px] text-slate-300">{title}</p>
      {hint && <p className="max-w-[300px] text-xs leading-relaxed text-slate-500">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function LoadingBar() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden">
      <div className="h-full w-1/3 animate-indeterminate bg-pylon-cyan/80" />
    </div>
  );
}

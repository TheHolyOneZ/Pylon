import { useRef, useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Folder, File, FileText, FileCode, Image, Film, Music,
  Archive, ArrowRight,
} from "lucide-react";
import { formatBytes, formatUnixTime, formatPermissions } from "../../lib/format";

interface Action {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}

interface Props {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink?: boolean;
  symlinkTarget?: string | null;
  size: number | null;
  modified: number | null;
  permissions?: number | null;
  selected: boolean;
  index: number;
  filterQuery?: string;
  onSelect: (index: number, shift: boolean, ctrl: boolean) => void;
  onOpen: () => void;
  onRename?: (newName: string) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  actions: Action[];
  showPermissions?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  autoRename?: boolean;
  onAutoRenameDone?: () => void;
}

const EXT_ICONS: Record<string, React.ReactNode> = {
  ts:   <FileCode size={13} className="text-pylon-cyan" />,
  tsx:  <FileCode size={13} className="text-pylon-cyan" />,
  js:   <FileCode size={13} className="text-pylon-cyan" />,
  jsx:  <FileCode size={13} className="text-pylon-cyan" />,
  rs:   <FileCode size={13} className="text-pylon-amber" />,
  py:   <FileCode size={13} className="text-pylon-green" />,
  go:   <FileCode size={13} className="text-sky-400" />,
  sh:   <FileCode size={13} className="text-slate-400" />,
  php:  <FileCode size={13} className="text-violet-400" />,
  html: <FileCode size={13} className="text-orange-400" />,
  css:  <FileCode size={13} className="text-blue-400" />,
  txt:  <FileText size={13} className="text-slate-400" />,
  md:   <FileText size={13} className="text-slate-400" />,
  json: <FileText size={13} className="text-pylon-amber" />,
  yaml: <FileText size={13} className="text-pylon-amber" />,
  yml:  <FileText size={13} className="text-pylon-amber" />,
  toml: <FileText size={13} className="text-pylon-amber" />,
  png:  <Image  size={13} className="text-pylon-amber" />,
  jpg:  <Image  size={13} className="text-pylon-amber" />,
  jpeg: <Image  size={13} className="text-pylon-amber" />,
  gif:  <Image  size={13} className="text-pylon-amber" />,
  svg:  <Image  size={13} className="text-pylon-amber" />,
  webp: <Image  size={13} className="text-pylon-amber" />,
  mp4:  <Film   size={13} className="text-pylon-violet" />,
  mkv:  <Film   size={13} className="text-pylon-violet" />,
  mov:  <Film   size={13} className="text-pylon-violet" />,
  avi:  <Film   size={13} className="text-pylon-violet" />,
  mp3:  <Music  size={13} className="text-pylon-green" />,
  flac: <Music  size={13} className="text-pylon-green" />,
  wav:  <Music  size={13} className="text-pylon-green" />,
  ogg:  <Music  size={13} className="text-pylon-green" />,
  zip:  <Archive size={13} className="text-violet-400" />,
  tar:  <Archive size={13} className="text-violet-400" />,
  gz:   <Archive size={13} className="text-violet-400" />,
  bz2:  <Archive size={13} className="text-violet-400" />,
  xz:   <Archive size={13} className="text-violet-400" />,
  "7z": <Archive size={13} className="text-violet-400" />,
};

function getIcon(name: string, isDir: boolean, isSymlink: boolean) {
  if (isDir)     return <Folder    size={13} className="text-pylon-violet" />;
  if (isSymlink) return <ArrowRight size={13} className="text-pylon-cyan"  />;
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return EXT_ICONS[ext] ?? <File size={13} className="text-slate-500" />;
}

function getHighlightIndices(query: string, name: string): Set<number> {
  const result = new Set<number>();
  if (!query.trim()) return result;
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  const sub = n.indexOf(q);
  if (sub >= 0) {
    for (let i = sub; i < sub + q.length; i++) result.add(i);
    return result;
  }
  let qi = 0;
  for (let ni = 0; ni < n.length && qi < q.length; ni++) {
    if (n[ni] === q[qi]) { result.add(ni); qi++; }
  }
  return qi === q.length ? result : new Set();
}

function HighlightedName({
  name, query, className, title,
}: { name: string; query?: string; className?: string; title?: string }) {
  const indices = useMemo(() => getHighlightIndices(query ?? "", name), [query, name]);

  if (!indices.size) {
    return <span className={className} title={title}>{name}</span>;
  }

  const spans: { text: string; hl: boolean }[] = [];
  let i = 0;
  while (i < name.length) {
    if (indices.has(i)) {
      let j = i;
      while (j < name.length && indices.has(j)) j++;
      spans.push({ text: name.slice(i, j), hl: true });
      i = j;
    } else {
      let j = i;
      while (j < name.length && !indices.has(j)) j++;
      spans.push({ text: name.slice(i, j), hl: false });
      i = j;
    }
  }

  return (
    <span className={className} title={title}>
      {spans.map((s, idx) =>
        s.hl
          ? <mark key={idx} className="bg-pylon-cyan/20 text-pylon-cyan rounded-[2px] px-px not-italic">{s.text}</mark>
          : <span key={idx}>{s.text}</span>
      )}
    </span>
  );
}

export function FileRow({
  name, isDir, isSymlink = false, symlinkTarget,
  size, modified, permissions, selected, index,
  filterQuery, onSelect, onOpen, onRename, onContextMenu,
  actions, showPermissions = false,
  draggable = false, onDragStart, onDrop,
  autoRename = false, onAutoRenameDone,
}: Props) {
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(name);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoRename && onRename && !renaming) {
      setRenameVal(name);
      setRenaming(true);
    }
  }, [autoRename]);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  function startRename(e?: React.MouseEvent) {
    e?.stopPropagation();
    if (!onRename) return;
    setRenameVal(name);
    setRenaming(true);
  }

  function commitRename() {
    const trimmed = renameVal.trim();
    if (trimmed && trimmed !== name) onRename?.(trimmed);
    setRenaming(false);
    onAutoRenameDone?.();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") commitRename();
    if (e.key === "Escape") { setRenaming(false); onAutoRenameDone?.(); }
    e.stopPropagation();
  }

  function handleClick(e: React.MouseEvent) {
    if (renaming) return;
    onSelect(index, e.shiftKey, e.ctrlKey || e.metaKey);
  }

  function handleDragOver(e: React.DragEvent) {
    if (isDir) { e.preventDefault(); setDragOver(true); }
  }

  return (
    <motion.div
      ref={dropRef as any}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-default group transition-colors border-b border-void-700/30 min-w-max
        ${selected ? "bg-pylon-cyan/8 border-l-2 border-l-pylon-cyan" : "hover:bg-void-700/60"}
        ${dragOver ? "bg-pylon-cyan/10 border border-pylon-cyan/40" : ""}
      `}
      {...{
        draggable,
        onDragStart,
        onDragOver: handleDragOver,
        onDragLeave: () => setDragOver(false),
        onDrop: (e: React.DragEvent) => { setDragOver(false); onDrop?.(e); },
        onContextMenu,
        onClick: handleClick,
        onDoubleClick: () => !renaming && onOpen(),
      } as any}
    >
      <span className="shrink-0 w-3 flex items-center">
        {selected && <span className="w-2 h-2 rounded-full bg-pylon-cyan block" />}
      </span>

      <span className="shrink-0">{getIcon(name, isDir, isSymlink)}</span>

      {renaming ? (
        <input
          ref={inputRef}
          value={renameVal}
          onChange={(e) => setRenameVal(e.target.value)}
          onBlur={commitRename}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 bg-void-700 border border-pylon-cyan/50 rounded px-1 py-0 text-xs text-slate-100 outline-none"
          autoFocus
        />
      ) : (
        <HighlightedName
          name={name}
          query={filterQuery}
          className={`flex-1 whitespace-nowrap text-xs
            ${isDir ? "text-slate-200 font-medium" : "text-slate-300"}
            ${isSymlink ? "italic text-pylon-cyan/80" : ""}
            ${name.startsWith(".") ? "opacity-60" : ""}
          `}
          title={isSymlink && symlinkTarget ? `→ ${symlinkTarget}` : name}
        />
      )}

      {isSymlink && symlinkTarget && !renaming && (
        <span className="text-slate-600 text-[10px] shrink-0 truncate max-w-[80px]">→ {symlinkTarget}</span>
      )}

      <span className="text-slate-600 text-xs w-16 text-right shrink-0">
        {!isDir && size != null ? formatBytes(size) : ""}
      </span>

      <span className="text-slate-600 text-xs w-28 text-right shrink-0 hidden lg:block">
        {formatUnixTime(modified)}
      </span>

      {showPermissions && (
        <span className="text-slate-600 text-[10px] font-mono w-24 text-right shrink-0 hidden xl:block">
          {formatPermissions(permissions ?? null)}
        </span>
      )}

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 w-16 justify-end">
        {onRename && !renaming && (
          <button
            title="Rename"
            onClick={startRename}
            className="p-1 rounded hover:bg-void-600 text-slate-500 hover:text-slate-200 transition-colors"
          >
            <FileText size={11} />
          </button>
        )}
        {actions.map((action) => (
          <button
            key={action.label}
            title={action.label}
            onClick={(e) => { e.stopPropagation(); action.onClick(); }}
            className={`p-1 rounded hover:bg-void-600 transition-colors ${
              action.danger
                ? "text-pylon-red/60 hover:text-pylon-red"
                : "text-slate-500 hover:text-slate-200"
            }`}
          >
            {action.icon}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { SortState } from "../../types";
import { formatBytes, formatPermissions, formatShortDate } from "../../lib/format";
import { useDragStore } from "../../stores/dragStore";
import type { Pane } from "../../stores/fileStore";
import type { Item } from "../../lib/fileOps";
import { FileIcon } from "./fileIcons";

export const ROW_HEIGHT = 28;

export interface Row {
  path: string;
  name: string;
  is_dir: boolean;
  is_symlink?: boolean;
  symlink_target?: string | null;
  size: number | null;
  modified: number | null;
  permissions?: number | null;
  hidden?: boolean;
}

interface Props {
  pane: Pane;
  rows: Row[];
  selected: Set<string>;
  cursor: string | null;
  active: boolean;
  sort: SortState;
  onSort: (f: SortState["field"]) => void;
  showPermissions?: boolean;
  filterQuery?: string;
  renaming: string | null;
  onRenameCommit: (row: Row, newName: string) => void;
  onRenameCancel: () => void;
  onSelect: (row: Row, index: number, shift: boolean, ctrl: boolean) => void;
  onOpen: (row: Row) => void;
  onContextMenu: (e: React.MouseEvent, row: Row | null) => void;
  prefix?: React.ReactNode;
  empty?: React.ReactNode;
}

type Cols = { size: boolean; modified: boolean; perms: boolean };

function useColumns(ref: React.RefObject<HTMLElement>, showPermissions: boolean): Cols {
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return { size: w > 280, modified: w > 430, perms: showPermissions && w > 590 };
}

function Highlight({ name, query }: { name: string; query?: string }) {
  const parts = useMemo(() => {
    const q = (query ?? "").trim().toLowerCase();
    if (!q) return null;
    const n = name.toLowerCase();
    const at = n.indexOf(q);
    if (at < 0) return null;
    return [name.slice(0, at), name.slice(at, at + q.length), name.slice(at + q.length)];
  }, [name, query]);
  if (!parts) return <>{name}</>;
  return (
    <>
      {parts[0]}
      <mark className="rounded-[2px] bg-pylon-amber/25 text-slate-50">{parts[1]}</mark>
      {parts[2]}
    </>
  );
}

const RowView = memo(function RowView({
  row, index, top, selected, isCursor, paneActive, cols, filterQuery, renaming, dropTarget, pane,
  onRenameCommit, onRenameCancel, onSelect, onOpen, onContextMenu, selectedSet, getDragItems,
}: {
  row: Row; index: number; top: number; selected: boolean; isCursor: boolean; paneActive: boolean; cols: Cols;
  filterQuery?: string; renaming: boolean; dropTarget: boolean; pane: Pane; selectedSet: Set<string>;
  getDragItems: (row: Row) => Item[];
  onRenameCommit: Props["onRenameCommit"]; onRenameCancel: Props["onRenameCancel"];
  onSelect: Props["onSelect"]; onOpen: Props["onOpen"]; onContextMenu: Props["onContextMenu"];
}) {
  const [val, setVal] = useState(row.name);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!renaming) return;
    setVal(row.name);
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      const dot = row.is_dir ? -1 : row.name.lastIndexOf(".");
      el.setSelectionRange(0, dot > 0 ? dot : row.name.length);
    });
  }, [renaming, row.name, row.is_dir]);

  const commit = () => {
    const v = val.trim();
    if (v && v !== row.name) onRenameCommit(row, v);
    else onRenameCancel();
  };

  return (
    <div
      data-row
      data-drop-dir={row.is_dir ? row.path : undefined}
      style={{ top, height: ROW_HEIGHT }}
      className={`absolute left-0 right-0 flex items-center gap-2 px-3 text-[13px] ${
        dropTarget
          ? "bg-pylon-cyan/20 ring-1 ring-inset ring-pylon-cyan/60"
          : selected
            ? paneActive ? "bg-pylon-cyan/15 text-slate-50" : "bg-void-600/70 text-slate-100"
            : index % 2 ? "bg-void-950/20 hover:bg-void-700/60" : "hover:bg-void-700/60"
      } ${isCursor && paneActive ? "shadow-[inset_2px_0_0_rgb(var(--accent))]" : ""}`}
      onPointerDown={(e) => {
        if (e.button !== 0 || renaming) return;
        const ctrl = e.ctrlKey || e.metaKey;
        if (!selected || ctrl || e.shiftKey) onSelect(row, index, e.shiftKey, ctrl);
        useDragStore.getState().begin(pane, getDragItems(row), e.clientX, e.clientY);
      }}
      onClick={(e) => {
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey && selected && selectedSet.size > 1) onSelect(row, index, false, false);
      }}
      onDoubleClick={() => !renaming && onOpen(row)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!selected) onSelect(row, index, false, false);
        onContextMenu(e, row);
      }}
      title={row.is_symlink && row.symlink_target ? `${row.name} → ${row.symlink_target}` : undefined}
    >
      <FileIcon name={row.name} isDir={row.is_dir} isSymlink={row.is_symlink} />
      {renaming ? (
        <input
          ref={input}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit();
            if (e.key === "Escape") onRenameCancel();
          }}
          spellCheck={false}
          className="h-[22px] min-w-0 flex-1 rounded border border-pylon-cyan/60 bg-void-950 px-1.5 text-[13px] text-slate-50 outline-none"
        />
      ) : (
        <span className={`min-w-0 flex-1 truncate ${row.is_dir ? "text-slate-100" : "text-slate-300"} ${row.hidden ? "opacity-60" : ""}`}>
          <Highlight name={row.name} query={filterQuery} />
          {row.is_symlink && row.symlink_target && <span className="ml-1.5 text-xs text-slate-500">→ {row.symlink_target}</span>}
        </span>
      )}
      {cols.size && <span className="tabular w-[72px] shrink-0 text-right text-xs text-slate-500">{row.is_dir ? "—" : row.size != null ? formatBytes(row.size) : ""}</span>}
      {cols.modified && <span className="tabular w-[118px] shrink-0 text-right text-xs text-slate-500">{formatShortDate(row.modified)}</span>}
      {cols.perms && <span className="w-[84px] shrink-0 text-right font-mono text-[11px] text-slate-500">{formatPermissions(row.permissions ?? null)}</span>}
    </div>
  );
});

function HeaderCell({ label, field, sort, onSort, className }: { label: string; field: SortState["field"] | null; sort: SortState; onSort: Props["onSort"]; className: string }) {
  const active = field && sort.field === field;
  return (
    <button
      disabled={!field}
      onClick={() => field && onSort(field)}
      className={`flex items-center gap-1 text-[11px] font-medium ${className} ${active ? "text-slate-200" : "text-slate-500 hover:text-slate-300"}`}
    >
      {label}
      {active && (sort.dir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
    </button>
  );
}

export function FileList(props: Props) {
  const { pane, rows, selected, cursor, active, sort, onSort, showPermissions = false, prefix, empty } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const prefixRef = useRef<HTMLDivElement>(null);
  const cols = useColumns(scroller, showPermissions);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const { active: dragging, overPane, overDir } = useDragStore();
  const rowsByPath = useMemo(() => new Map(rows.map((r) => [r.path, r])), [rows]);
  const getDragItems = useCallback(
    (row: Row): Item[] => {
      const toItem = (r: Row) => ({ path: r.path, name: r.name, is_dir: r.is_dir });
      if (selected.has(row.path) && selected.size > 1) {
        return Array.from(selected).map((p) => rowsByPath.get(p)).filter((r): r is Row => !!r).map(toItem);
      }
      return [toItem(row)];
    },
    [selected, rowsByPath],
  );

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !cursor) return;
    const idx = rows.findIndex((r) => r.path === cursor);
    if (idx < 0) return;
    const offset = prefixRef.current?.offsetHeight ?? 0;
    const top = offset + idx * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
  }, [cursor, rows]);

  const offset = prefixRef.current?.offsetHeight ?? 0;
  const first = Math.max(0, Math.floor((scrollTop - offset) / ROW_HEIGHT) - 10);
  const last = Math.min(rows.length, Math.ceil((scrollTop - offset + height) / ROW_HEIGHT) + 10);
  const dropOnPane = dragging && overPane === pane && !overDir;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-void-600 px-3">
        <span className="w-4 shrink-0" />
        <HeaderCell label="Name" field="name" sort={sort} onSort={onSort} className="min-w-0 flex-1" />
        {cols.size && <HeaderCell label="Size" field="size" sort={sort} onSort={onSort} className="w-[72px] shrink-0 justify-end" />}
        {cols.modified && <HeaderCell label="Modified" field="modified" sort={sort} onSort={onSort} className="w-[118px] shrink-0 justify-end" />}
        {cols.perms && <HeaderCell label="Permissions" field={null} sort={sort} onSort={onSort} className="w-[84px] shrink-0 justify-end" />}
      </div>
      <div
        ref={scroller}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        onContextMenu={(e) => { e.preventDefault(); props.onContextMenu(e, null); }}
        className={`relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden ${dropOnPane ? "bg-pylon-cyan/[0.05] ring-1 ring-inset ring-pylon-cyan/40" : ""}`}
      >
        <div ref={prefixRef}>{prefix}</div>
        {rows.length === 0 ? (
          empty
        ) : (
          <div style={{ height: rows.length * ROW_HEIGHT }} className="relative">
            {rows.slice(first, last).map((row, i) => {
              const index = first + i;
              return (
                <RowView
                  key={row.path}
                  row={row}
                  index={index}
                  top={index * ROW_HEIGHT}
                  pane={pane}
                  selected={selected.has(row.path)}
                  selectedSet={selected}
                  getDragItems={getDragItems}
                  isCursor={cursor === row.path}
                  paneActive={active}
                  cols={cols}
                  filterQuery={props.filterQuery}
                  renaming={props.renaming === row.path}
                  dropTarget={dragging && overPane === pane && overDir === row.path}
                  onRenameCommit={props.onRenameCommit}
                  onRenameCancel={props.onRenameCancel}
                  onSelect={props.onSelect}
                  onOpen={props.onOpen}
                  onContextMenu={props.onContextMenu}
                />
              );
            })}
          </div>
        )}
        <div className="h-8" />
      </div>
    </div>
  );
}

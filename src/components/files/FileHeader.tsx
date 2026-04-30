import { ChevronDown, ChevronUp } from "lucide-react";
import { SortState } from "../../types";

interface Column {
  field: SortState["field"] | null;
  label: string;
  className: string;
}

interface Props {
  sort: SortState;
  onSort: (field: SortState["field"]) => void;
  showPermissions?: boolean;
}

const BASE_COLS: Column[] = [
  { field: "name", label: "Name", className: "flex-1 min-w-0" },
  { field: "size", label: "Size", className: "w-16 text-right shrink-0" },
  { field: "modified", label: "Modified", className: "w-28 text-right shrink-0 hidden lg:block" },
  { field: "type", label: "Type", className: "w-12 text-right shrink-0 hidden xl:block" },
];

const PERM_COL: Column = {
  field: null,
  label: "Perm",
  className: "w-24 text-right shrink-0 hidden xl:block",
};

export function FileHeader({ sort, onSort, showPermissions = false }: Props) {
  const cols = showPermissions ? [...BASE_COLS, PERM_COL] : BASE_COLS;

  return (
    <div className="flex items-center gap-2 px-3 py-1 bg-void-900/80 border-b border-void-600 sticky top-0 z-10">
      {cols.map((col) => {
        const active = col.field && sort.field === col.field;
        return (
          <button
            key={col.label}
            onClick={() => col.field && onSort(col.field)}
            disabled={!col.field}
            className={`${col.className} flex items-center gap-1 text-xs font-medium transition-colors select-none
              ${col.field ? "cursor-pointer" : "cursor-default"}
              ${active ? "text-pylon-cyan" : "text-slate-500 hover:text-slate-300"}
            `}
          >
            {col.label === "Name" ? null : null}
            <span>{col.label}</span>
            {active && (
              sort.dir === "asc"
                ? <ChevronUp size={10} />
                : <ChevronDown size={10} />
            )}
          </button>
        );
      })}
      {}
      <div className="w-16 shrink-0" />
    </div>
  );
}

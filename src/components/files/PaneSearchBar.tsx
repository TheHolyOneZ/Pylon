import { Search, X } from "lucide-react";

export type TypeFilter = "all" | "folders" | "code" | "images" | "media" | "docs" | "archives";

const TYPES: { id: TypeFilter; label: string }[] = [
  { id: "all", label: "All types" },
  { id: "folders", label: "Folders" },
  { id: "code", label: "Code" },
  { id: "images", label: "Images" },
  { id: "media", label: "Audio & video" },
  { id: "docs", label: "Documents" },
  { id: "archives", label: "Archives" },
];

interface Props {
  value: string;
  onChange: (v: string) => void;
  matchCount: number;
  totalCount: number;
  inputRef?: React.RefObject<HTMLInputElement>;
  side: "local" | "remote";
  typeFilter: TypeFilter;
  onTypeFilter: (t: TypeFilter) => void;
  regexMode?: boolean;
  onRegexToggle?: () => void;
}

export function PaneSearchBar({ value, onChange, matchCount, totalCount, inputRef, typeFilter, onTypeFilter, regexMode, onRegexToggle }: Props) {
  const filtering = value.trim() !== "" || typeFilter !== "all";
  let badRegex = false;
  if (regexMode && value) {
    try { new RegExp(value); } catch { badRegex = true; }
  }
  return (
    <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-void-600 px-2">
      <div className={`flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border bg-void-950/40 px-2 ${badRegex ? "border-pylon-red/60" : "border-void-600 focus-within:border-pylon-cyan/60"}`}>
        <Search size={13} className="shrink-0 text-slate-500" />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { onChange(""); onTypeFilter("all"); e.currentTarget.blur(); }
            if (e.key === "ArrowDown" || e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder={regexMode ? "Filter (regular expression)" : "Filter"}
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent text-xs text-slate-200 outline-none"
        />
        {filtering && <span className="tabular shrink-0 text-[11px] text-slate-500">{matchCount}/{totalCount}</span>}
        {value && (
          <button onClick={() => onChange("")} className="shrink-0 rounded p-0.5 text-slate-500 hover:text-slate-200" title="Clear">
            <X size={12} />
          </button>
        )}
        {onRegexToggle && (
          <button
            onClick={onRegexToggle}
            title="Regular expression"
            className={`shrink-0 rounded px-1 font-mono text-[11px] ${regexMode ? "bg-pylon-cyan/15 text-pylon-cyan" : "text-slate-500 hover:text-slate-300"}`}
          >
            .*
          </button>
        )}
      </div>
      <select
        value={typeFilter}
        onChange={(e) => onTypeFilter(e.target.value as TypeFilter)}
        className={`h-7 shrink-0 rounded-md text-xs ${typeFilter !== "all" ? "!border-pylon-cyan/50 text-pylon-cyan" : ""}`}
        title="Filter by type"
      >
        {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
    </div>
  );
}

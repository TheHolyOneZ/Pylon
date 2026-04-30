import { useState } from "react";
import { Search, X, Regex } from "lucide-react";

export type TypeFilter = "all" | "folders" | "code" | "images" | "media" | "docs" | "archives";

const CHIPS: { id: TypeFilter; label: string }[] = [
  { id: "all",      label: "All"      },
  { id: "folders",  label: "Folders"  },
  { id: "code",     label: "Code"     },
  { id: "images",   label: "Images"   },
  { id: "media",    label: "Media"    },
  { id: "docs",     label: "Docs"     },
  { id: "archives", label: "Archives" },
];

interface Props {
  value: string;
  onChange: (v: string) => void;
  matchCount: number;
  totalCount: number;
  inputRef: React.RefObject<HTMLInputElement>;
  side: "local" | "remote";
  typeFilter: TypeFilter;
  onTypeFilter: (t: TypeFilter) => void;
  regexMode: boolean;
  onRegexToggle: () => void;
}

export function PaneSearchBar({
  value, onChange, matchCount, totalCount,
  inputRef, side, typeFilter, onTypeFilter,
  regexMode, onRegexToggle,
}: Props) {
  const [focused, setFocused] = useState(false);
  const isFiltering = value.trim() !== "" || typeFilter !== "all";
  const isCyan   = side === "local";

  const focusRing = focused
    ? isCyan
      ? "border-pylon-cyan/40 bg-void-800 shadow-[0_0_14px_rgba(0,229,255,0.1)]"
      : "border-pylon-violet/40 bg-void-800 shadow-[0_0_14px_rgba(180,77,255,0.1)]"
    : "border-void-600/60 bg-void-850 hover:border-void-500";

  const chipActive = isCyan
    ? "bg-pylon-cyan/12 border-pylon-cyan/35 text-pylon-cyan"
    : "bg-pylon-violet/12 border-pylon-violet/35 text-pylon-violet";

  const countColor = isCyan ? "text-pylon-cyan/75" : "text-pylon-violet/75";
  const iconColor  = focused
    ? isCyan ? "text-pylon-cyan" : "text-pylon-violet"
    : "text-slate-600";

  return (
    <div className="bg-void-900 border-b border-void-600 px-2 pt-1.5 pb-1">
      <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md border transition-all duration-150 ${focusRing}`}>
        <Search size={11} className={`shrink-0 transition-colors ${iconColor}`} />

        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { onChange(""); onTypeFilter("all"); e.currentTarget.blur(); }
          }}
          placeholder={focused ? "Search files…" : "Search  ·  Ctrl+F"}
          className="flex-1 min-w-0 bg-transparent text-xs text-slate-200 placeholder-slate-600 outline-none"
          spellCheck={false}
        />

        {isFiltering && (
          <span className={`text-[10px] font-mono font-semibold shrink-0 tabular-nums ${countColor}`}>
            {matchCount}<span className="opacity-40">/</span>{totalCount}
          </span>
        )}

        <button
          onClick={onRegexToggle}
          title={regexMode ? "Regex on — click to disable" : "Enable regex mode"}
          className={`p-0.5 rounded transition-colors shrink-0 ${
            regexMode
              ? isCyan
                ? "bg-pylon-cyan/12 text-pylon-cyan"
                : "bg-pylon-violet/12 text-pylon-violet"
              : "text-slate-600 hover:text-slate-400"
          }`}
        >
          <Regex size={10} />
        </button>

        {value && (
          <button
            onClick={() => onChange("")}
            className="text-slate-600 hover:text-slate-300 transition-colors shrink-0"
            title="Clear search"
          >
            <X size={11} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 mt-1 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {CHIPS.map((chip) => (
          <button
            key={chip.id}
            onClick={() => onTypeFilter(chip.id === typeFilter ? "all" : chip.id)}
            className={`px-2 py-px rounded text-[10px] font-medium whitespace-nowrap transition-all shrink-0 border ${
              typeFilter === chip.id
                ? chipActive
                : "bg-transparent border-transparent text-slate-600 hover:text-slate-300"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
}

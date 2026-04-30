import { motion } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";

export type OverwriteAction = "overwrite" | "skip" | "cancel";

interface Props {
  conflicts: string[];
  onChoice: (action: OverwriteAction) => void;
}

export function OverwriteModal({ conflicts, onChoice }: Props) {
  const count = conflicts.length;
  const label = count === 1 ? "1 file" : `${count} files`;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={() => onChoice("cancel")}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        className="w-[460px] bg-void-800 border border-void-500 rounded-xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-3 px-5 py-4 bg-void-900 border-b border-void-600">
          <AlertTriangle size={14} className="text-pylon-amber shrink-0" />
          <span className="text-sm font-semibold text-slate-200">
            {label} already {count === 1 ? "exists" : "exist"} at destination
          </span>
          <div className="flex-1" />
          <button
            onClick={() => onChoice("cancel")}
            className="p-1 rounded hover:bg-void-700 text-slate-500 hover:text-slate-300 transition-colors"
          >
            <X size={13} />
          </button>
        </div>

        <div className="px-5 py-3 max-h-48 overflow-y-auto">
          <ul className="space-y-0.5">
            {conflicts.slice(0, 30).map((name) => (
              <li
                key={name}
                className="text-xs font-mono text-pylon-amber/80 bg-pylon-amber/5 rounded px-2 py-1 truncate"
              >
                {name}
              </li>
            ))}
            {count > 30 && (
              <li className="text-xs text-slate-600 px-2 py-1">
                …and {count - 30} more
              </li>
            )}
          </ul>
        </div>

        <div className="px-5 pb-5 pt-3 flex gap-2 justify-end border-t border-void-700">
          <button
            onClick={() => onChoice("cancel")}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-void-700 border border-void-600 text-slate-400 hover:bg-void-600 hover:text-slate-200 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={() => onChoice("skip")}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-void-700 border border-void-500 text-slate-200 hover:bg-void-600 hover:border-void-400 transition-all"
          >
            Skip existing
          </button>
          <button
            onClick={() => onChoice("overwrite")}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-pylon-cyan/10 border border-pylon-cyan/30 text-pylon-cyan hover:bg-pylon-cyan/20 transition-all"
          >
            Overwrite {label}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

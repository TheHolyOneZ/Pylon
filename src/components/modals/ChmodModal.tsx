import { useState } from "react";
import { motion } from "framer-motion";
import { Lock, X } from "lucide-react";
import { formatPermissions } from "../../lib/format";

interface Props {
  path: string;
  currentPerm: number;
  onApply: (mode: number) => void;
  onClose: () => void;
}

type Who = "owner" | "group" | "other";
type Bit = "read" | "write" | "exec";

const WHO_LABELS: Record<Who, string> = { owner: "Owner", group: "Group", other: "Other" };
const BIT_LABELS: Record<Bit, string> = { read: "r", write: "w", exec: "x" };
const WHO_SHIFT: Record<Who, number> = { owner: 6, group: 3, other: 0 };
const BIT_VALUE: Record<Bit, number> = { read: 4, write: 2, exec: 1 };

export function ChmodModal({ path, currentPerm, onApply, onClose }: Props) {
  const [perm, setPerm] = useState(currentPerm & 0o777);
  const [octalInput, setOctalInput] = useState((currentPerm & 0o777).toString(8).padStart(3, "0"));

  function getBit(who: Who, bit: Bit) {
    return !!(perm & (BIT_VALUE[bit] << WHO_SHIFT[who]));
  }

  function toggleBit(who: Who, bit: Bit) {
    const mask = BIT_VALUE[bit] << WHO_SHIFT[who];
    const next = perm ^ mask;
    setPerm(next);
    setOctalInput(next.toString(8).padStart(3, "0"));
  }

  function handleOctalChange(val: string) {
    setOctalInput(val);
    if (/^[0-7]{1,3}$/.test(val)) {
      const n = parseInt(val, 8);
      setPerm(n);
    }
  }

  const whos: Who[] = ["owner", "group", "other"];
  const bits: Bit[] = ["read", "write", "exec"];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        className="w-[380px] bg-void-800 border border-void-500 rounded-xl shadow-2xl overflow-hidden"
      >
        {}
        <div className="flex items-center gap-3 px-5 py-4 bg-void-900 border-b border-void-600">
          <Lock size={14} className="text-pylon-cyan shrink-0" />
          <span className="text-sm font-semibold text-slate-200">Change Permissions</span>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 rounded hover:bg-void-700 text-slate-500 hover:text-slate-300 transition-colors">
            <X size={13} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {}
          <p className="text-xs text-slate-500 font-mono truncate">{path}</p>

          {}
          <div className="grid grid-cols-4 gap-px bg-void-600 rounded-lg overflow-hidden text-xs">
            <div className="bg-void-900 px-2 py-1.5 text-slate-600 font-semibold" />
            {bits.map((b) => (
              <div key={b} className="bg-void-900 px-2 py-1.5 text-center text-slate-500 font-semibold uppercase tracking-wide">
                {BIT_LABELS[b]}
              </div>
            ))}
            {whos.map((w) => (
              <>
                <div key={`${w}-label`} className="bg-void-800 px-2 py-2 text-slate-400 font-medium">
                  {WHO_LABELS[w]}
                </div>
                {bits.map((b) => {
                  const active = getBit(w, b);
                  return (
                    <button
                      key={`${w}-${b}`}
                      onClick={() => toggleBit(w, b)}
                      className={`bg-void-800 py-2 flex items-center justify-center transition-colors
                        ${active ? "text-pylon-cyan" : "text-void-600 hover:text-slate-500"}`}
                    >
                      <span className={`w-4 h-4 rounded text-[11px] font-mono flex items-center justify-center
                        ${active ? "bg-pylon-cyan/15 text-pylon-cyan" : "text-slate-600"}`}>
                        {active ? BIT_LABELS[b] : "—"}
                      </span>
                    </button>
                  );
                })}
              </>
            ))}
          </div>

          {}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Octal</span>
              <input
                value={octalInput}
                onChange={(e) => handleOctalChange(e.target.value)}
                maxLength={3}
                className="w-16 bg-void-700 border border-void-500 rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-pylon-cyan/50 text-center"
              />
            </div>
            <span className="text-xs font-mono text-slate-400">{formatPermissions(perm)}</span>
          </div>
        </div>

        {}
        <div className="flex gap-2 px-5 pb-5 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-void-700 transition-colors border border-void-500">
            Cancel
          </button>
          <button
            onClick={() => { onApply(perm); onClose(); }}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-pylon-cyan/10 border border-pylon-cyan/30 text-pylon-cyan hover:bg-pylon-cyan/20 transition-all"
          >
            Apply
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

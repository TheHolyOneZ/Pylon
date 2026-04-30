import { createContext, useCallback, useContext, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, X } from "lucide-react";
import { checkLockPassword } from "../AppLock";

interface PromptOptions {
  title?: string;
  description?: string;
}

type PromptFn = (opts?: PromptOptions) => Promise<boolean>;

const LockPasswordContext = createContext<PromptFn>(() => Promise.resolve(false));

export function useLockPasswordPrompt() {
  return useContext(LockPasswordContext);
}

export function LockPasswordProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [opts, setOpts] = useState<PromptOptions>({});
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const prompt: PromptFn = useCallback((options) => {
    setOpts(options ?? {});
    setPw("");
    setError("");
    setLoading(false);
    setVisible(true);
    setTimeout(() => inputRef.current?.focus(), 50);
    return new Promise((resolve) => { resolveRef.current = resolve; });
  }, []);

  async function handleConfirm() {
    if (!pw) { setError("Enter your app lock password"); return; }
    setLoading(true);
    const ok = await checkLockPassword(pw);
    setLoading(false);
    if (!ok) { setError("Wrong password"); setPw(""); setTimeout(() => inputRef.current?.focus(), 0); return; }
    setVisible(false);
    resolveRef.current?.(true);
  }

  function handleCancel() {
    setVisible(false);
    resolveRef.current?.(false);
  }

  return (
    <LockPasswordContext.Provider value={prompt}>
      {children}
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center"
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleCancel} />
            <motion.div
              initial={{ scale: 0.94, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.94, opacity: 0, y: 8 }}
              transition={{ type: "spring", stiffness: 500, damping: 35 }}
              className="relative z-10 w-80 bg-void-900 border border-void-600 rounded-2xl shadow-2xl overflow-hidden"
            >
              {}
              <div className="flex items-center gap-3 px-5 pt-5 pb-4">
                <div className="w-9 h-9 rounded-xl bg-pylon-amber/10 border border-pylon-amber/20 flex items-center justify-center shrink-0">
                  <Lock size={16} className="text-pylon-amber" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-200">{opts.title ?? "App Lock Required"}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{opts.description ?? "Enter your app lock password to continue"}</p>
                </div>
                <button onClick={handleCancel} className="p-1 rounded-lg hover:bg-void-700 text-slate-600 hover:text-slate-300 transition-colors shrink-0">
                  <X size={14} />
                </button>
              </div>

              {}
              <div className="px-5 pb-2">
                <input
                  ref={inputRef}
                  type="password"
                  value={pw}
                  onChange={(e) => { setPw(e.target.value); setError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); if (e.key === "Escape") handleCancel(); }}
                  placeholder="App lock password"
                  className="w-full bg-void-800 border border-void-600 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-pylon-amber/50 transition-colors"
                />
                {error && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-xs text-pylon-red mt-1.5"
                  >
                    {error}
                  </motion.p>
                )}
              </div>

              {}
              <div className="flex gap-2 px-5 py-4 border-t border-void-700/50 mt-2">
                <button onClick={handleCancel}
                  className="flex-1 py-2 rounded-lg border border-void-600 text-xs text-slate-400 hover:text-slate-200 hover:bg-void-800 transition-colors">
                  Cancel
                </button>
                <button onClick={handleConfirm} disabled={!pw || loading}
                  className="flex-1 py-2 rounded-lg bg-pylon-amber/15 border border-pylon-amber/30 text-xs text-pylon-amber hover:bg-pylon-amber/25 transition-colors disabled:opacity-40">
                  {loading ? "Checking…" : "Confirm"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </LockPasswordContext.Provider>
  );
}

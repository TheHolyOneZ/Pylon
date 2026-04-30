import { createContext, useCallback, useContext, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => false);

interface DialogState {
  open: boolean;
  options: ConfirmOptions;
  resolve: (v: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const confirm = useCallback((options: ConfirmOptions | string): Promise<boolean> => {
    return new Promise((resolve) => {
      const normalized: ConfirmOptions =
        typeof options === "string" ? { message: options } : options;
      setDialog({ open: true, options: normalized, resolve });
    });
  }, []);

  function handleConfirm() {
    dialog?.resolve(true);
    setDialog(null);
  }

  function handleCancel() {
    dialog?.resolve(false);
    setDialog(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AnimatePresence>
        {dialog?.open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={handleCancel}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              className="w-[380px] bg-void-800 border border-void-500 rounded-xl shadow-2xl overflow-hidden"
            >
              <div className="flex items-center gap-3 px-5 py-4 bg-void-900 border-b border-void-600">
                {dialog.options.danger && (
                  <AlertTriangle size={15} className="text-pylon-red shrink-0" />
                )}
                <span className="text-sm font-semibold text-slate-200">
                  {dialog.options.title ?? (dialog.options.danger ? "Confirm Action" : "Confirm")}
                </span>
                <div className="flex-1" />
                <button
                  onClick={handleCancel}
                  className="p-1 rounded hover:bg-void-700 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <X size={13} />
                </button>
              </div>
              <div className="px-5 py-4">
                <p className="text-sm text-slate-300 leading-relaxed">
                  {dialog.options.message}
                </p>
              </div>
              <div className="flex gap-2 px-5 pb-5 justify-end">
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-void-700 transition-colors border border-void-500"
                >
                  {dialog.options.cancelLabel ?? "Cancel"}
                </button>
                <button
                  onClick={handleConfirm}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border ${
                    dialog.options.danger
                      ? "bg-pylon-red/10 border-pylon-red/30 text-pylon-red hover:bg-pylon-red/20"
                      : "bg-pylon-cyan/10 border-pylon-cyan/30 text-pylon-cyan hover:bg-pylon-cyan/20"
                  }`}
                >
                  {dialog.options.confirmLabel ?? (dialog.options.danger ? "Delete" : "Confirm")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

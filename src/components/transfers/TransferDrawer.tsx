import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeftRight, X } from "lucide-react";
import { useTransferStore, isActive } from "../../stores/transferStore";
import { useUiStore } from "../../stores/uiStore";
import { TransferRow } from "./TransferRow";
import { Button, IconButton } from "../ui/primitives";

export function TransferDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { transfers, clearCompleted } = useTransferStore();
  const active = transfers.filter((t) => isActive(t.state));
  const recent = transfers.filter((t) => !isActive(t.state)).slice(0, 50);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose} className="fixed inset-0 top-10 z-[150] bg-black/25" />
          <motion.aside
            initial={{ x: 24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 24, opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
            className="fixed bottom-7 right-0 top-10 z-[160] flex w-[380px] flex-col border-l border-void-600 bg-void-800 shadow-modal"
          >
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-void-600 px-3">
              <ArrowLeftRight size={14} className="text-pylon-cyan" />
              <span className="text-[13px] font-semibold text-slate-100">Transfers</span>
              {active.length > 0 && <span className="tabular rounded-full bg-pylon-cyan/15 px-1.5 text-[11px] font-medium text-pylon-cyan">{active.length} active</span>}
              <div className="flex-1" />
              {recent.length > 0 && <Button size="sm" variant="ghost" onClick={clearCompleted}>Clear finished</Button>}
              <IconButton onClick={onClose} title="Close"><X size={15} /></IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {transfers.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-16 text-center">
                  <ArrowLeftRight size={20} className="text-slate-600" />
                  <p className="text-[13px] text-slate-400">No transfers yet</p>
                  <p className="text-xs text-slate-500">Drag files between the panes to start one.</p>
                </div>
              )}
              {active.map((t) => <TransferRow key={t.id} t={t} dense />)}
              {recent.length > 0 && active.length > 0 && <div className="px-2.5 pb-1 pt-3 text-[11px] font-medium text-slate-500">Finished</div>}
              {recent.map((t) => <TransferRow key={t.id} t={t} dense />)}
            </div>
            <div className="shrink-0 border-t border-void-600 px-3 py-2">
              <button onClick={() => { onClose(); useUiStore.getState().setActiveTab("transfers"); }} className="text-xs text-slate-400 hover:text-slate-100">
                Open full transfer history →
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

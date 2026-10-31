import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useToastStore, ToastType } from "../../stores/toastStore";

const ICON: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 size={15} className="text-pylon-green" />,
  error: <XCircle size={15} className="text-pylon-red" />,
  warning: <AlertTriangle size={15} className="text-pylon-amber" />,
  info: <Info size={15} className="text-slate-400" />,
};

export function ToastContainer() {
  const { toasts, dismiss } = useToastStore();
  return (
    <div className="pointer-events-none fixed bottom-9 right-4 z-[9000] flex w-[360px] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.slice(-4).map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.16 }}
            className="pointer-events-auto flex items-start gap-2.5 rounded-lg bg-void-700 px-3 py-2.5 shadow-popover"
          >
            <span className="mt-px shrink-0">{ICON[t.type]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium leading-snug text-slate-100">{t.title}</p>
              {t.message && <p className="selectable mt-0.5 whitespace-pre-line break-words text-xs leading-snug text-slate-400">{t.message}</p>}
            </div>
            <button onClick={() => dismiss(t.id)} className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-void-600 hover:text-slate-200" title="Dismiss">
              <X size={13} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

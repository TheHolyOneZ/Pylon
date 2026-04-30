import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  XCircle,
} from "lucide-react";
import { Toast as ToastType, ToastType as TType, useToastStore } from "../../stores/toastStore";

const ICONS: Record<TType, React.ReactNode> = {
  success: <CheckCircle2 size={16} className="text-pylon-green shrink-0" />,
  error: <XCircle size={16} className="text-pylon-red shrink-0" />,
  warning: <AlertTriangle size={16} className="text-pylon-amber shrink-0" />,
  info: <Info size={16} className="text-pylon-cyan shrink-0" />,
};

const BORDERS: Record<TType, string> = {
  success: "border-pylon-green/30",
  error: "border-pylon-red/30",
  warning: "border-pylon-amber/30",
  info: "border-pylon-cyan/30",
};

const GLOWS: Record<TType, string> = {
  success: "shadow-[0_0_16px_rgba(0,255,157,0.15)]",
  error: "shadow-[0_0_16px_rgba(255,69,96,0.15)]",
  warning: "shadow-[0_0_16px_rgba(255,170,0,0.15)]",
  info: "shadow-[0_0_16px_rgba(0,229,255,0.15)]",
};

function ToastItem({ toast }: { toast: ToastType }) {
  const { dismiss } = useToastStore();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 48, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 48, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className={`flex items-start gap-3 w-80 bg-void-800 border ${BORDERS[toast.type]} ${GLOWS[toast.type]} rounded-xl px-4 py-3 pointer-events-auto`}
    >
      <span className="mt-0.5">{ICONS[toast.type]}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-200 leading-tight">{toast.title}</p>
        {toast.message && (
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{toast.message}</p>
        )}
      </div>
      <button
        onClick={() => dismiss(toast.id)}
        className="p-0.5 rounded hover:bg-void-700 text-slate-600 hover:text-slate-300 transition-colors shrink-0 mt-0.5"
      >
        <X size={13} />
      </button>
    </motion.div>
  );
}

export function ToastContainer() {
  const { toasts } = useToastStore();

  return (
    <div className="fixed top-12 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}

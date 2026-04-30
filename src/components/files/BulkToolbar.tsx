import { Download, Trash2, Upload, X, Shield } from "lucide-react";
import { motion } from "framer-motion";

interface Props {
  count: number;
  side: "local" | "remote";
  onUpload?: () => void;
  onUploadClean?: () => void;
  onDownload?: () => void;
  onDelete: () => void;
  onDeselect: () => void;
}

export function BulkToolbar({ count, side, onUpload, onUploadClean, onDownload, onDelete, onDeselect }: Props) {
  return (
    <motion.div
      initial={{ y: "100%", opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: "100%", opacity: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 35 }}
      className="sticky bottom-0 left-0 right-0 z-20 backdrop-blur-md"
    >
      <div className="flex items-center gap-2 px-3 py-2 bg-void-900/90 border-t border-pylon-cyan/20 shadow-[0_-4px_20px_rgba(0,229,255,0.06)]">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-pylon-cyan animate-pulse" />
          <span className="text-xs font-semibold text-pylon-cyan tabular-nums">{count} selected</span>
        </div>
        <div className="w-px h-4 bg-void-600 mx-1" />

        {side === "local" && onUpload && (
          <button
            onClick={onUpload}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-300 hover:text-slate-100 hover:bg-void-700 transition-colors"
          >
            <Upload size={11} /> Upload
          </button>
        )}
        {side === "local" && onUploadClean && (
          <button
            onClick={onUploadClean}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-pylon-amber hover:bg-pylon-amber/10 transition-colors"
          >
            <Shield size={11} /> Clean
          </button>
        )}
        {side === "remote" && onDownload && (
          <button
            onClick={onDownload}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-pylon-cyan/80 hover:text-pylon-cyan hover:bg-pylon-cyan/10 transition-colors"
          >
            <Download size={11} /> Download
          </button>
        )}

        <button
          onClick={onDelete}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-pylon-red/70 hover:text-pylon-red hover:bg-pylon-red/10 transition-colors"
        >
          <Trash2 size={11} /> Delete
        </button>

        <div className="flex-1" />

        <button
          onClick={onDeselect}
          className="p-1 rounded hover:bg-void-700 text-slate-500 hover:text-slate-300 transition-colors"
        >
          <X size={12} />
        </button>
      </div>
    </motion.div>
  );
}

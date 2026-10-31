import { motion } from "framer-motion";
import { Download, Shield, Trash2, Upload, X } from "lucide-react";
import { Button, IconButton } from "../ui/primitives";

interface Props {
  count: number;
  side: "local" | "remote";
  canTransfer: boolean;
  transferTarget: string;
  onUpload?: () => void;
  onUploadClean?: () => void;
  onDownload?: () => void;
  onDelete: () => void;
  onDeselect: () => void;
}

export function BulkToolbar({ count, side, canTransfer, transferTarget, onUpload, onUploadClean, onDownload, onDelete, onDeselect }: Props) {
  const target = transferTarget.split("/").filter(Boolean).pop() || transferTarget;
  return (
    <motion.div
      initial={{ y: 12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 12, opacity: 0 }}
      transition={{ duration: 0.14 }}
      className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3"
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-lg bg-void-700 p-1 pl-3 shadow-popover">
        <span className="tabular mr-2 text-xs font-medium text-slate-200">{count} selected</span>
        {side === "local" ? (
          <>
            <Button size="sm" variant="primary" icon={<Upload size={13} />} onClick={onUpload} disabled={!canTransfer} title={canTransfer ? `Upload to ${transferTarget}` : "Not connected"}>
              Upload to {target}
            </Button>
            <Button size="sm" variant="ghost" icon={<Shield size={13} />} onClick={onUploadClean} disabled={!canTransfer} title="Upload with metadata removed">
              Clean
            </Button>
          </>
        ) : (
          <Button size="sm" variant="primary" icon={<Download size={13} />} onClick={onDownload} title={`Download to ${transferTarget}`}>
            Download to {target}
          </Button>
        )}
        <Button size="sm" variant="danger-ghost" icon={<Trash2 size={13} />} onClick={onDelete}>Delete</Button>
        <div className="mx-0.5 h-4 w-px bg-void-500" />
        <IconButton onClick={onDeselect} title="Clear selection (Esc)"><X size={14} /></IconButton>
      </div>
    </motion.div>
  );
}

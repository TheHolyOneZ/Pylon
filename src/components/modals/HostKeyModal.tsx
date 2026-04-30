import { motion } from "framer-motion";
import { AlertTriangle, Shield, X } from "lucide-react";

interface Props {
  host: string;
  port: number;
  fingerprint: string;
  keyType: string;
  changed: boolean;
  onAccept: (permanent: boolean) => void;
  onReject: () => void;
}

export function HostKeyModal({ host, port, fingerprint, keyType, changed, onAccept, onReject }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-void-900 border border-void-600 rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {}
        <div className="flex items-start gap-3 mb-5">
          <div className={`p-2 rounded-lg ${changed ? "bg-red-900/30 border border-red-800/40" : "bg-amber-900/30 border border-amber-800/40"}`}>
            <AlertTriangle size={18} className={changed ? "text-red-400" : "text-amber-400"} />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-bold text-slate-100">
              {changed ? "⚠ Host Key Changed" : "Unknown Host Key"}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">{host}:{port}</p>
          </div>
          <button onClick={onReject} className="p-1 rounded hover:bg-void-700 text-slate-500">
            <X size={14} />
          </button>
        </div>

        {}
        {changed ? (
          <div className="bg-red-900/20 border border-red-800/30 rounded-lg p-3 mb-4">
            <p className="text-xs text-red-400 font-medium mb-1">Possible man-in-the-middle attack</p>
            <p className="text-xs text-slate-500">
              The host key for <span className="text-slate-300">{host}</span> has changed since your last connection.
              This could indicate a server compromise or a MITM attack. Only proceed if you know the host key changed legitimately.
            </p>
          </div>
        ) : (
          <p className="text-xs text-slate-500 mb-4">
            The authenticity of <span className="text-slate-300">{host}</span> can't be established.
            Verify this fingerprint with the server administrator before accepting.
          </p>
        )}

        {}
        <div className="bg-void-800 border border-void-600 rounded-lg p-3 mb-5">
          <div className="flex items-center gap-2 mb-1">
            <Shield size={11} className="text-slate-600" />
            <span className="text-[10px] text-slate-600 uppercase tracking-wider">{keyType} Fingerprint</span>
          </div>
          <code className="text-xs text-pylon-cyan font-mono break-all">{fingerprint}</code>
        </div>

        {}
        <div className="flex gap-2">
          <button
            onClick={onReject}
            className="flex-1 py-2 rounded-lg border border-void-600 text-sm text-slate-400 hover:text-slate-200 hover:bg-void-700 transition-colors"
          >
            Reject
          </button>
          <button
            onClick={() => onAccept(false)}
            className="flex-1 py-2 rounded-lg border border-amber-800/40 text-sm text-amber-400 hover:bg-amber-900/20 transition-colors"
          >
            Accept Once
          </button>
          <button
            onClick={() => onAccept(true)}
            className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
              changed
                ? "border border-red-800/40 text-red-400 hover:bg-red-900/20"
                : "bg-pylon-cyan/10 border border-pylon-cyan/30 text-pylon-cyan hover:bg-pylon-cyan/20"
            }`}
          >
            {changed ? "Trust Anyway" : "Always Trust"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}




import { motion, AnimatePresence } from "framer-motion";
import { useTransferStore } from "../../stores/transferStore";
import { useConnectionStore } from "../../stores/connectionStore";

type BeamState = "idle" | "connected" | "transferring" | "stripping";

function useBeamState(): BeamState {
  const { connections } = useConnectionStore();
  const { transfers } = useTransferStore();

  const hasConnection = connections.length > 0;
  const activeTransfer = transfers.find((t) => t.state === "running");

  if (activeTransfer?.strip_metadata) return "stripping";
  if (activeTransfer) return "transferring";
  if (hasConnection) return "connected";
  return "idle";
}

const STATE_COLORS: Record<BeamState, { glow: string; beam: string; dot: string }> = {
  idle: {
    glow: "rgba(30,40,60,0.0)",
    beam: "from-transparent via-slate-700/30 to-transparent",
    dot: "bg-slate-700",
  },
  connected: {
    glow: "rgba(180,77,255,0.15)",
    beam: "from-transparent via-pylon-violet/40 to-transparent",
    dot: "bg-pylon-violet",
  },
  transferring: {
    glow: "rgba(0,229,255,0.15)",
    beam: "from-transparent via-pylon-cyan/60 to-transparent",
    dot: "bg-pylon-cyan",
  },
  stripping: {
    glow: "rgba(255,170,0,0.15)",
    beam: "from-transparent via-pylon-amber/60 to-transparent",
    dot: "bg-pylon-amber",
  },
};

export function PylonBeam() {
  const state = useBeamState();
  const colors = STATE_COLORS[state];
  const isActive = state === "transferring" || state === "stripping";

  return (
    <div
      className="relative w-px shrink-0 self-stretch overflow-hidden"
      style={{ boxShadow: `0 0 12px ${colors.glow}` }}
    >
      {}
      <div className={`absolute inset-0 bg-gradient-to-b ${colors.beam}`} />

      {}
      <AnimatePresence>
        {isActive && (
          <motion.div
            key="flow"
            className={`absolute left-0 right-0 h-16 bg-gradient-to-b from-transparent ${
              state === "stripping"
                ? "via-pylon-amber/80"
                : "via-pylon-cyan/80"
            } to-transparent`}
            initial={{ top: "-10%" }}
            animate={{ top: "110%" }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
          />
        )}
      </AnimatePresence>

      {}
      <motion.div
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full ${colors.dot}`}
        animate={isActive ? { scale: [1, 1.5, 1], opacity: [1, 0.6, 1] } : {}}
        transition={{ duration: 1.2, repeat: Infinity }}
      />
    </div>
  );
}

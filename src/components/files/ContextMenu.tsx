import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  separator?: never;
}

export interface ContextMenuSeparator {
  separator: true;
  label?: never;
  icon?: never;
  onClick?: never;
  danger?: never;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

interface Props {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent && e.key === "Escape") { onClose(); return; }
      if (e instanceof MouseEvent && ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", handle);
    };
  }, [onClose]);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const menuW = 200;
  const menuH = items.length * 30;
  const finalX = x + menuW > vw ? vw - menuW - 8 : x;
  const finalY = y + menuH > vh ? Math.max(8, vh - menuH - 8) : y;

  return createPortal(
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.08 }}
      style={{ left: finalX, top: finalY, position: "fixed" }}
      className="z-[9999] w-[200px] bg-void-800 border border-void-500 rounded-lg shadow-2xl overflow-hidden py-1"
    >
      {items.map((item, i) => {
        if ("separator" in item && item.separator) {
          return <div key={i} className="my-1 border-t border-void-600" />;
        }
        const mi = item as ContextMenuItem;
        return (
          <button
            key={i}
            onClick={() => { mi.onClick(); onClose(); }}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors text-left
              ${mi.danger
                ? "text-pylon-red hover:bg-pylon-red/10"
                : "text-slate-300 hover:bg-void-700 hover:text-slate-100"
              }`}
          >
            {mi.icon && <span className="w-3.5 h-3.5 shrink-0 flex items-center">{mi.icon}</span>}
            {mi.label}
          </button>
        );
      })}
    </motion.div>,
    document.body
  );
}

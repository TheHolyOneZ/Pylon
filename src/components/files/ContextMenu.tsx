import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
  separator?: never;
}

export interface ContextMenuSeparator {
  separator: true;
  label?: never;
  icon?: never;
  onClick?: never;
  danger?: never;
  disabled?: never;
  shortcut?: never;
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
  const [pos, setPos] = useState({ left: x, top: y });
  const [focus, setFocus] = useState(-1);
  const actionable = items.map((it, i) => (!("separator" in it && it.separator) && !it.disabled ? i : -1)).filter((i) => i >= 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - width - 6);
    const top = y + height > window.innerHeight - 6 ? Math.max(6, y - height) : y;
    setPos({ left: Math.max(6, left), top });
  }, [x, y]);

  useEffect(() => {
    function onMouse(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setFocus((f) => {
          const at = actionable.indexOf(f);
          const next = e.key === "ArrowDown" ? (at + 1) % actionable.length : (at - 1 + actionable.length) % actionable.length;
          return actionable[next] ?? -1;
        });
      }
      if (e.key === "Enter" && focus >= 0) {
        e.preventDefault();
        e.stopPropagation();
        const it = items[focus] as ContextMenuItem;
        it.onClick();
        onClose();
      }
    }
    document.addEventListener("mousedown", onMouse);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onMouse);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose, focus, items, actionable]);

  return createPortal(
    <motion.div
      ref={ref}
      role="menu"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.08 }}
      style={{ left: pos.left, top: pos.top, position: "fixed", transformOrigin: "top left" }}
      className="z-[9999] min-w-[196px] max-w-[300px] rounded-lg bg-void-800 p-1 shadow-popover"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        if ("separator" in item && item.separator) return <div key={i} className="mx-1 my-1 h-px bg-void-600" />;
        const mi = item as ContextMenuItem;
        return (
          <button
            key={i}
            role="menuitem"
            disabled={mi.disabled}
            onMouseEnter={() => setFocus(i)}
            onClick={() => { mi.onClick(); onClose(); }}
            className={`flex h-7 w-full items-center gap-2.5 rounded-md px-2 text-left text-[12.5px] disabled:opacity-40 ${
              focus === i ? (mi.danger ? "bg-pylon-red/12 text-pylon-red" : "bg-void-600 text-slate-100") : mi.danger ? "text-pylon-red" : "text-slate-300"
            }`}
          >
            <span className="flex w-4 shrink-0 items-center justify-center opacity-80">{mi.icon}</span>
            <span className="flex-1 truncate">{mi.label}</span>
            {mi.shortcut && <span className="ml-3 shrink-0 text-[11px] text-slate-500">{mi.shortcut}</span>}
          </button>
        );
      })}
    </motion.div>,
    document.body,
  );
}

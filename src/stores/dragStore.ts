import { create } from "zustand";
import type { Pane } from "./fileStore";
import type { Item } from "../lib/fileOps";

export type DropHandler = (items: Item[], source: Pane, targetDir: string | null) => void;

interface DragState {
  pending: { source: Pane; items: Item[]; x0: number; y0: number } | null;
  active: boolean;
  source: Pane | null;
  items: Item[];
  x: number;
  y: number;
  overPane: Pane | null;
  overDir: string | null;
  handlers: Partial<Record<Pane, DropHandler>>;

  begin: (source: Pane, items: Item[], x: number, y: number) => void;
  registerHandler: (pane: Pane, h: DropHandler) => () => void;
}

const THRESHOLD = 5;

export const useDragStore = create<DragState>((set, get) => {
  function hitTest(x: number, y: number) {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const paneEl = el?.closest<HTMLElement>("[data-pane]");
    const dirEl = el?.closest<HTMLElement>("[data-drop-dir]");
    return {
      overPane: (paneEl?.dataset.pane as Pane | undefined) ?? null,
      overDir: dirEl && paneEl?.contains(dirEl) ? dirEl.dataset.dropDir ?? null : null,
    };
  }

  function onMove(e: PointerEvent) {
    const s = get();
    if (!s.pending) return;
    if (!s.active) {
      if (Math.hypot(e.clientX - s.pending.x0, e.clientY - s.pending.y0) < THRESHOLD) return;
      set({ active: true, source: s.pending.source, items: s.pending.items });
      document.body.style.cursor = "grabbing";
    }
    const hit = hitTest(e.clientX, e.clientY);
    const overDir = hit.overDir && s.pending.items.some((i) => i.path === hit.overDir) ? null : hit.overDir;
    set({ x: e.clientX, y: e.clientY, overPane: hit.overPane, overDir });
  }

  function end(commit: boolean) {
    const s = get();
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("keydown", onKey, true);
    document.body.style.cursor = "";
    if (commit && s.active && s.source && s.overPane) {
      const crossPane = s.overPane !== s.source;
      const intoFolder = !!s.overDir;
      if (crossPane || intoFolder) s.handlers[s.overPane]?.(s.items, s.source, s.overDir);
    }
    if (s.active) {
      const swallow = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    }
    set({ pending: null, active: false, source: null, items: [], overPane: null, overDir: null });
  }

  function onUp() { end(true); }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); end(false); }
  }

  return {
    pending: null,
    active: false,
    source: null,
    items: [],
    x: 0,
    y: 0,
    overPane: null,
    overDir: null,
    handlers: {},

    begin: (source, items, x, y) => {
      if (!items.length) return;
      set({ pending: { source, items, x0: x, y0: y }, x, y });
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("keydown", onKey, true);
    },

    registerHandler: (pane, h) => {
      set((s) => ({ handlers: { ...s.handlers, [pane]: h } }));
      return () => set((s) => {
        const { [pane]: _gone, ...rest } = s.handlers;
        return { handlers: rest };
      });
    },
  };
});

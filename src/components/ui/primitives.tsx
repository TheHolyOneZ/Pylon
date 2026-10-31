import { forwardRef, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-pylon-cyan text-on-accent font-medium hover:brightness-110 active:brightness-95",
  secondary: "border border-void-500 bg-void-700 text-slate-200 hover:bg-void-600 hover:border-void-400",
  ghost: "text-slate-300 hover:bg-void-700 hover:text-slate-100",
  danger: "bg-pylon-red text-[rgb(40_6_8)] font-medium hover:brightness-110",
  "danger-ghost": "text-pylon-red hover:bg-pylon-red/10",
};
const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5 rounded-md",
  md: "h-8 px-3.5 text-[13px] gap-2 rounded-md",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className = "", children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap transition-[background-color,border-color,filter,color] disabled:pointer-events-none disabled:opacity-45 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; tone?: "default" | "danger" }>(
  function IconButton({ className = "", active, tone = "default", children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-35 ${
          active
            ? "bg-pylon-cyan/15 text-pylon-cyan"
            : tone === "danger"
              ? "text-slate-400 hover:bg-pylon-red/10 hover:text-pylon-red"
              : "text-slate-400 hover:bg-void-700 hover:text-slate-100"
        } ${className}`}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-80 ${className}`} />;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Field({ label, hint, error, children, className = "" }: { label?: React.ReactNode; hint?: React.ReactNode; error?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="field-label">{label}</span>}
      {children}
      {error ? <span className="mt-1 block text-xs text-pylon-red">{error}</span> : hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }>(function Input(
  { className = "", mono, ...rest },
  ref,
) {
  return <input ref={ref} spellCheck={false} autoComplete="off" className={`field ${mono ? "font-mono text-xs" : ""} ${className}`} {...rest} />;
});

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${checked ? "bg-pylon-cyan" : "bg-void-500"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className = "" }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; className?: string }) {
  return (
    <div className={`inline-flex rounded-md border border-void-600 bg-void-900 p-0.5 ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex h-7 flex-1 items-center justify-center gap-1.5 rounded px-3 text-xs transition-colors ${
            value === o.value ? "bg-void-600 text-slate-100 shadow-sm" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const modalStack: number[] = [];
let modalSeq = 0;

export function Modal({
  onClose,
  title,
  subtitle,
  icon,
  width = 480,
  children,
  dismissable = true,
  headerExtra,
}: {
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  width?: number;
  children: React.ReactNode;
  dismissable?: boolean;
  headerExtra?: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const id = useRef(0);
  useEffect(() => {
    id.current = ++modalSeq;
    modalStack.push(id.current);
    return () => {
      const i = modalStack.indexOf(id.current);
      if (i >= 0) modalStack.splice(i, 1);
    };
  }, []);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dismissRef = useRef(dismissable);
  dismissRef.current = dismissable;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissRef.current && modalStack[modalStack.length - 1] === id.current && !document.querySelector('[role="menu"]')) {
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const el = panel.current?.querySelector<HTMLElement>("[data-autofocus], input:not([type=checkbox]), textarea, select");
      (el ?? panel.current)?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget && dismissable) onClose(); }}
    >
      <motion.div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0, y: 6, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 4, scale: 0.985 }}
        transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
        style={{ width }}
        className="flex max-h-[min(88vh,820px)] max-w-full flex-col overflow-hidden rounded-xl bg-void-800 shadow-modal outline-none"
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-void-600 px-5 pb-3.5 pt-4">
          {icon && <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-void-500 bg-void-700 text-slate-300">{icon}</div>}
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold leading-tight text-slate-100">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs leading-snug text-slate-500">{subtitle}</p>}
          </div>
          {headerExtra}
          {dismissable && (
            <IconButton onClick={onClose} title="Close (Esc)" className="-mr-1.5 -mt-0.5">
              <X size={15} />
            </IconButton>
          )}
        </div>
        {children}
      </motion.div>
    </motion.div>,
    document.body,
  );
}

export function ModalBody({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`min-h-0 flex-1 overflow-y-auto px-5 py-4 ${className}`}>{children}</div>;
}

export function ModalFooter({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex shrink-0 items-center justify-end gap-2 border-t border-void-600 bg-void-900/60 px-5 py-3 ${className}`}>{children}</div>;
}

export function Callout({ tone = "info", icon, children }: { tone?: "info" | "warn" | "danger" | "ok"; icon?: React.ReactNode; children: React.ReactNode }) {
  const cls = {
    info: "border-void-500 bg-void-700/50 text-slate-300",
    warn: "border-pylon-amber/30 bg-pylon-amber/8 text-slate-200",
    danger: "border-pylon-red/35 bg-pylon-red/8 text-slate-200",
    ok: "border-pylon-green/30 bg-pylon-green/8 text-slate-200",
  }[tone];
  const iconCls = { info: "text-slate-400", warn: "text-pylon-amber", danger: "text-pylon-red", ok: "text-pylon-green" }[tone];
  return (
    <div className={`flex gap-2.5 rounded-lg border px-3 py-2.5 text-xs leading-relaxed ${cls}`}>
      {icon && <span className={`mt-px shrink-0 ${iconCls}`}>{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function PylonMark({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <rect x="2.5" y="4" width="7" height="16" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <rect x="14.5" y="4" width="7" height="16" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9.5 9.5h5M9.5 14.5h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="m12.6 7.9 1.9 1.6-1.9 1.6M11.4 12.9l-1.9 1.6 1.9 1.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StatusDot({ tone }: { tone: "ok" | "warn" | "danger" | "idle" | "busy" }) {
  const cls = {
    ok: "bg-pylon-green",
    warn: "bg-pylon-amber",
    danger: "bg-pylon-red",
    idle: "bg-slate-600",
    busy: "bg-pylon-cyan animate-pulse",
  }[tone];
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${cls}`} />;
}

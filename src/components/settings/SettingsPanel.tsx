import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useConfirm } from "../ui/ConfirmDialog";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, Info, Palette, Plus, Settings,
  Shield, Terminal as TermIcon, Trash2, Zap,
  Lock, Key, Wifi, Database, HelpCircle, AlertTriangle,
  Gauge, Type, Code2, Package, Check, Server, Layers,
  FolderOpen, Cpu, Globe, ChevronRight,
} from "lucide-react";
import { useSnippets } from "../terminal/useSnippets";
import { useSettingsStore, ThemeName, HostKeyPolicy, DefaultShell } from "../../stores/settingsStore";
import { clearLockPassword, hasLockPassword, setLockPassword } from "../AppLock";
import { useLockPasswordPrompt } from "../ui/LockPasswordPrompt";
import { toast } from "../../stores/toastStore";
import type { AppSettings } from "../../stores/settingsStore";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-void-800 border border-void-600/60 rounded-xl overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

function CardHeader({ icon, title, sub, accent = false }: {
  icon?: React.ReactNode; title: string; sub?: string; accent?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 px-5 py-4 border-b border-void-600/40 ${accent ? "bg-pylon-cyan/3" : ""}`}>
      {icon && (
        <div className="w-7 h-7 rounded-lg bg-void-700 border border-void-600/50 flex items-center justify-center shrink-0 text-pylon-cyan">
          {icon}
        </div>
      )}
      <div>
        <p className="text-sm font-semibold text-slate-200">{title}</p>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function Row({ label, sub, children, last = false }: {
  label: string; sub?: string; children: React.ReactNode; last?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-6 px-5 py-3.5 ${!last ? "border-b border-void-600/25" : ""}`}>
      <div className="min-w-0">
        <p className="text-sm text-slate-300 leading-none">{label}</p>
        {sub && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{sub}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-all duration-200 ${checked ? "bg-pylon-cyan/70" : "bg-void-600"} disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      <motion.span
        animate={{ x: checked ? 20 : 2 }}
        transition={{ type: "spring", stiffness: 500, damping: 35 }}
        className="absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm block"
      />
    </button>
  );
}

function NumericInput({
  value, onChange, min, max, unit, width = "w-20",
}: {
  value: number; onChange: (v: number) => void;
  min: number; max: number; unit?: string; width?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? String(value);

  function commit(raw: string) {
    const n = parseInt(raw, 10);
    setDraft(null);
    if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
    else onChange(value);
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text" inputMode="numeric" value={display}
        onFocus={(e) => { setDraft(String(value)); e.target.select(); }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { setDraft(null); (e.target as HTMLInputElement).blur(); }
        }}
        className={`${width} bg-void-900 border border-void-600 rounded-lg px-2 py-1.5 text-sm text-slate-200 text-right focus:outline-none focus:border-pylon-cyan/50 tabular-nums transition-colors`}
      />
      {unit && <span className="text-xs text-slate-500 shrink-0">{unit}</span>}
    </div>
  );
}

interface SecurityTabProps { s: AppSettings & { set: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void } }
function SecurityTab({ s }: SecurityTabProps) {
  const promptLockPassword = useLockPasswordPrompt();
  const [lockEnabled, setLockEnabled] = useState(hasLockPassword());
  const [newLockPw, setNewLockPw] = useState("");
  const [confirmLockPw, setConfirmLockPw] = useState("");
  const [lockErr, setLockErr] = useState("");
  async function handleSetLock() {
    if (newLockPw.length < 4) { setLockErr("Minimum 4 characters"); return; }
    if (newLockPw !== confirmLockPw) { setLockErr("Passwords don't match"); return; }
    await setLockPassword(newLockPw);
    setLockEnabled(true);
    setNewLockPw(""); setConfirmLockPw(""); setLockErr("");
    toast.success("App lock enabled", "Password required on next launch");
  }

  async function handleRemoveLock() {
    const ok = await promptLockPassword({
      title: "Remove App Lock",
      description: "Enter your current app lock password to disable it.",
    });
    if (!ok) return;
    clearLockPassword();
    setLockEnabled(false);
    toast.info("App lock removed");
  }

  const HOST_KEY_OPTS: { value: HostKeyPolicy; label: string; desc: string; icon: React.ReactNode; danger?: boolean }[] = [
    { value: "ask",         label: "Ask",         desc: "Show the fingerprint for unknown hosts", icon: <HelpCircle size={13} /> },
    { value: "auto-accept", label: "Accept new", desc: "Trust unknown hosts automatically; changed keys still ask", icon: <Wifi size={13} />, danger: true },
    { value: "strict",      label: "Strict",      desc: "Only hosts already in known_hosts", icon: <Shield size={13} /> },
  ];

  return (
    <div className="space-y-4 max-w-xl">
      <Card>
        <CardHeader icon={<Database size={14} />} title="ZVault" sub="Credential store settings" />
        <Row label="Auto-lock timeout" sub="Lock ZVault after N minutes of idle (0 = never)" last>
          <div className="flex items-center gap-2">
            <NumericInput value={s.vaultAutoLockMinutes} min={0} max={1440} unit="min"
              onChange={(v) => s.set("vaultAutoLockMinutes", v)} />
          </div>
        </Row>
        <div className="flex items-center gap-1.5 px-5 py-3 bg-void-900/60 border-t border-void-600/30 text-[10px] text-slate-600 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-pylon-green inline-block shrink-0" />
          AES-256-GCM · Argon2id · 32-byte random salt per vault
        </div>
      </Card>

      <Card>
        <CardHeader icon={<Key size={14} />} title="Host Key Policy" sub="How to handle unrecognized SSH server fingerprints" />
        <div className="p-3 grid grid-cols-3 gap-2">
          {HOST_KEY_OPTS.map((opt) => {
            const active = s.hostKeyPolicy === opt.value;
            return (
              <button key={opt.value} onClick={() => s.set("hostKeyPolicy", opt.value)}
                className={`flex flex-col gap-1.5 p-3 rounded-xl border transition-all text-left ${
                  active
                    ? opt.danger
                      ? "border-pylon-red/40 bg-pylon-red/5"
                      : "border-pylon-cyan/40 bg-pylon-cyan/5"
                    : "border-void-600/50 hover:border-void-500 bg-void-900/30"
                }`}>
                <div className={`flex items-center gap-1.5 ${active ? opt.danger ? "text-pylon-red" : "text-pylon-cyan" : "text-slate-400"}`}>
                  {opt.icon}
                  <span className="text-xs font-semibold">{opt.label}</span>
                </div>
                <p className="text-[10px] text-slate-500 leading-relaxed">{opt.desc}</p>
              </button>
            );
          })}
        </div>
        <AnimatePresence>
          {s.hostKeyPolicy === "auto-accept" && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
              className="mx-3 mb-3 px-3 py-2 rounded-lg bg-pylon-red/5 border border-pylon-red/20 flex items-center gap-2">
              <AlertTriangle size={11} className="text-pylon-red shrink-0" />
              <p className="text-xs text-pylon-red/80">New hosts are trusted without checking their fingerprint. Only use this on networks you control.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      <Card>
        <div className="flex items-center justify-between px-5 py-4 border-b border-void-600/40">
          <div className="flex items-center gap-3">
            <div className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
              lockEnabled ? "bg-pylon-amber/10 border-pylon-amber/30 text-pylon-amber" : "bg-void-700 border-void-600/50 text-slate-500"
            }`}>
              <Lock size={14} />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-200">App Lock</p>
              <p className="text-xs text-slate-500 mt-0.5">Require a password to open Pylon</p>
            </div>
          </div>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border tracking-widest uppercase ${
            lockEnabled
              ? "text-pylon-green/90 border-pylon-green/25 bg-pylon-green/8"
              : "text-slate-600 border-void-600/40 bg-void-700/30"
          }`}>
            {lockEnabled ? "On" : "Off"}
          </span>
        </div>
        <div className="p-4 space-y-3">
          {lockEnabled ? (
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">Password is set. Remove to disable app lock.</p>
              <button onClick={handleRemoveLock}
                className="text-xs px-3 py-1.5 rounded-lg border border-red-900/50 text-red-400 hover:bg-red-900/15 transition-colors">
                Remove lock
              </button>
            </div>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
              <input type="password" placeholder="New password (min 4 chars)" value={newLockPw}
                onChange={(e) => { setNewLockPw(e.target.value); setLockErr(""); }}
                className="w-full bg-void-900 border border-void-600 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-pylon-cyan/50 transition-colors" />
              <input type="password" placeholder="Confirm password" value={confirmLockPw}
                onChange={(e) => { setConfirmLockPw(e.target.value); setLockErr(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleSetLock(); }}
                className="w-full bg-void-900 border border-void-600 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-pylon-cyan/50 transition-colors" />
              <AnimatePresence>
                {lockErr && (
                  <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }} className="text-xs text-pylon-red">
                    {lockErr}
                  </motion.p>
                )}
              </AnimatePresence>
              <button onClick={handleSetLock} disabled={!newLockPw || !confirmLockPw}
                className="w-full py-2.5 rounded-lg bg-pylon-amber/10 border border-pylon-amber/25 text-sm text-pylon-amber hover:bg-pylon-amber/15 transition-colors disabled:opacity-30 font-medium">
                Enable app lock
              </button>
            </motion.div>
          )}
        </div>
      </Card>
    </div>
  );
}

type Tab = "snippets" | "transfers" | "terminal" | "security" | "appearance" | "general" | "about";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "general",    label: "General",    icon: <Globe size={14} /> },
  { id: "appearance", label: "Appearance", icon: <Palette size={14} /> },
  { id: "terminal",   label: "Terminal",   icon: <TermIcon size={14} /> },
  { id: "transfers",  label: "Transfers",  icon: <Activity size={14} /> },
  { id: "security",   label: "Security",   icon: <Shield size={14} /> },
  { id: "snippets",   label: "Snippets",   icon: <Zap size={14} /> },
  { id: "about",      label: "About",      icon: <Info size={14} /> },
];

const INPUT = "w-full bg-void-900 border border-void-600 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-pylon-cyan/50 transition-colors";
const MONO_INPUT = `${INPUT} font-mono text-xs`;

export function SettingsPanel() {
  const [tab, setTab] = useState<Tab>("general");
  const confirmDialog = useConfirm();
  const [version, setVersion] = useState("");
  useEffect(() => { getVersion().then(setVersion).catch(() => {}); }, []);
  const { snippets, addSnippet, removeSnippet } = useSnippets();
  const [newLabel, setNewLabel] = useState("");
  const [newCmd, setNewCmd] = useState("");
  const [newColor, setNewColor] = useState("#00e5ff");

  const s = useSettingsStore();

  async function handleAddSnippet() {
    if (!newLabel || !newCmd) return;
    await addSnippet(newLabel, newCmd, newColor);
    setNewLabel(""); setNewCmd("");
  }

  const THEMES: { id: ThemeName; label: string; accent: string; bg: string; sidebar: string; desc: string }[] = [
    { id: "deep-void", label: "Deep Void", accent: "#22d3ee", bg: "#0a0b0e", sidebar: "#0f1115", desc: "Cyan" },
    { id: "night", label: "Night", accent: "#a78bfa", bg: "#0d1117", sidebar: "#11161d", desc: "Violet" },
    { id: "soft-void", label: "Soft Void", accent: "#38bdf8", bg: "#0f172a", sidebar: "#131c31", desc: "Sky blue" },
    { id: "neon", label: "Neon", accent: "#4ade80", bg: "#060b09", sidebar: "#090f0c", desc: "Green" },
    { id: "amber", label: "Amber", accent: "#f5a623", bg: "#0d0b08", sidebar: "#120f0b", desc: "Gold" },
    { id: "rose", label: "Rose", accent: "#fb7185", bg: "#0e0a0c", sidebar: "#130e10", desc: "Pink" },
    { id: "forest", label: "Forest", accent: "#2dd4bf", bg: "#080c0b", sidebar: "#0b110f", desc: "Teal" },
  ];

  const CHUNK_PRESETS = [
    { label: "64 KB", value: 64 },
    { label: "128 KB", value: 128 },
    { label: "256 KB", value: 256 },
    { label: "512 KB", value: 512 },
    { label: "1 MB", value: 1024 },
    { label: "2 MB", value: 2048 },
  ];

  const SHELL_OPTS: { path: DefaultShell; label: string; desc: string }[] = [
    { path: "",     label: "Login shell", desc: "Whatever the account uses" },
    { path: "bash", label: "bash", desc: "If installed" },
    { path: "zsh",  label: "zsh",  desc: "If installed" },
    { path: "fish", label: "fish", desc: "If installed" },
    { path: "sh",   label: "sh",   desc: "POSIX shell" },
  ];

  const FONT_PRESETS = [
    '"JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace',
    '"Fira Code", monospace',
    '"Cascadia Code", Consolas, monospace',
    'Menlo, Monaco, monospace',
    "monospace",
  ];

  return (
    <div className="flex h-full bg-void-900">
      <div className="w-36 border-r border-void-600/60 flex flex-col py-3 shrink-0 bg-void-950/50">
        <div className="flex items-center gap-2 px-3 pb-3 border-b border-void-600/40 mb-1">
          <Settings size={12} className="text-pylon-cyan" />
          <span className="text-xs font-bold text-slate-300 tracking-wide">Settings</span>
        </div>
        <div className="px-3 pb-3 border-b border-void-600/30 mb-2">
          <span className="text-[11px] text-slate-500">Changes save automatically</span>
        </div>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-3 py-2.5 text-xs transition-all text-left relative ${
              tab === t.id
                ? "text-pylon-cyan bg-pylon-cyan/6 border-r-2 border-pylon-cyan"
                : "text-slate-500 hover:text-slate-300 hover:bg-void-800/40"
            }`}>
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">

        {tab === "snippets" && (
          <div className="space-y-4 max-w-2xl">
            <div>
              <h2 className="text-base font-semibold text-slate-200">Command Snippets</h2>
              <p className="text-xs text-slate-500 mt-0.5">One-click terminal commands, saved across sessions</p>
            </div>

            <div className="flex gap-3 px-4 py-3 bg-pylon-cyan/4 border border-pylon-cyan/15 rounded-xl">
              <Zap size={14} className="text-pylon-cyan shrink-0 mt-0.5" />
              <div className="text-xs text-slate-400 space-y-1">
                <p>Snippets appear as <span className="text-pylon-cyan">toolbar buttons</span> above the terminal. Click one to instantly send that command to the active shell — no typing needed.</p>
                <p className="text-slate-500">Great for: <span className="font-mono text-slate-400">docker-compose up -d</span> · <span className="font-mono text-slate-400">systemctl restart nginx</span> · <span className="font-mono text-slate-400">tail -f /var/log/syslog</span></p>
              </div>
            </div>

            <Card>
              <CardHeader icon={<Plus size={14} />} title="New Snippet" />
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-xs text-slate-500 mb-1.5">Label</p>
                    <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                      placeholder="Deploy" className={INPUT} />
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-slate-500 mb-1.5">Command</p>
                    <input value={newCmd} onChange={(e) => setNewCmd(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddSnippet(); }}
                      placeholder="docker-compose up -d" className={MONO_INPUT} />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-slate-500">Color</label>
                    <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)}
                      className="w-8 h-8 rounded-lg cursor-pointer border-0 bg-transparent" />
                    <div className="flex gap-1">
                      {["#00e5ff","#b44dff","#f59e0b","#00ff9d","#f43f5e","#38bdf8"].map((c) => (
                        <button key={c} onClick={() => setNewColor(c)}
                          className={`w-5 h-5 rounded-full border-2 transition-all ${newColor === c ? "border-white scale-110" : "border-transparent"}`}
                          style={{ background: c }} />
                      ))}
                    </div>
                  </div>
                  <button onClick={handleAddSnippet} disabled={!newLabel || !newCmd}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-pylon-cyan/10 border border-pylon-cyan/25 text-pylon-cyan text-sm font-medium hover:bg-pylon-cyan/15 transition-colors disabled:opacity-30">
                    <Plus size={13} /> Add snippet
                  </button>
                </div>
              </div>
            </Card>

            <div className="space-y-1.5">
              {snippets.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-10 text-slate-600">
                  <Zap size={20} />
                  <p className="text-xs">No snippets yet — add your first one above</p>
                </div>
              )}
              {snippets.map((sn) => (
                <motion.div key={sn.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  className="group flex items-center gap-3 px-4 py-3 bg-void-800 border border-void-600/50 rounded-xl hover:border-void-500 transition-colors">
                  <div className="w-2 h-8 rounded-full shrink-0" style={{ background: sn.color ?? "#00e5ff" }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200 font-medium">{sn.label}</p>
                    <p className="text-xs text-slate-500 font-mono truncate mt-0.5">{sn.command}</p>
                  </div>
                  <button onClick={() => removeSnippet(sn.id)}
                    className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-void-700 text-slate-600 hover:text-pylon-red transition-all">
                    <Trash2 size={13} />
                  </button>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {tab === "transfers" && (
          <div className="space-y-4 max-w-xl">
            <div>
              <h2 className="text-base font-semibold text-slate-200">Transfers</h2>
              <p className="text-xs text-slate-500 mt-0.5">Control parallelism, speed, and transfer behavior</p>
            </div>

            <Card>
              <CardHeader icon={<Cpu size={14} />} title="Parallelism" sub="Simultaneous file transfers per session" />
              <div className="px-5 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-300">Concurrent workers</p>
                  <NumericInput value={s.maxConcurrentTransfers} min={1} max={16}
                    onChange={(v) => s.set("maxConcurrentTransfers", v)} />
                </div>
                <div className="flex gap-1.5 flex-wrap pt-1">
                  {Array.from({ length: 16 }).map((_, i) => (
                    <button key={i} onClick={() => s.set("maxConcurrentTransfers", i + 1)}
                      className={`w-5 h-5 rounded transition-all ${
                        i < s.maxConcurrentTransfers
                          ? "bg-pylon-cyan/70 shadow-[0_0_4px_rgba(0,229,255,0.4)]"
                          : "bg-void-700 hover:bg-void-600"
                      }`} />
                  ))}
                  <span className="text-[10px] text-slate-600 self-center ml-1">{s.maxConcurrentTransfers} workers</span>
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader icon={<Gauge size={14} />} title="Performance" sub="Chunk size and bandwidth throttle" />
              <div className="px-5 py-4 space-y-4 border-b border-void-600/30">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-slate-300">Chunk size</p>
                    <NumericInput value={s.defaultChunkKb} min={16} max={8192} unit="KB"
                      onChange={(v) => s.set("defaultChunkKb", v)} />
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {CHUNK_PRESETS.map((p) => (
                      <button key={p.value} onClick={() => s.set("defaultChunkKb", p.value)}
                        className={`px-2.5 py-1 rounded-lg text-xs border transition-all ${
                          s.defaultChunkKb === p.value
                            ? "border-pylon-cyan/50 bg-pylon-cyan/10 text-pylon-cyan"
                            : "border-void-600/60 text-slate-500 hover:text-slate-300 hover:border-void-500"
                        }`}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="px-5 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-300">Bandwidth limit</p>
                    <p className="text-xs text-slate-500 mt-0.5">{s.bandwidthLimitKbps === 0 ? "Unlimited — no throttle applied" : `Capped at ${s.bandwidthLimitKbps} KB/s`}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {s.bandwidthLimitKbps > 0 && (
                      <button onClick={() => s.set("bandwidthLimitKbps", 0)}
                        className="text-[10px] px-2 py-1 rounded border border-void-600/50 text-slate-500 hover:text-slate-300 transition-colors">
                        Unlimited
                      </button>
                    )}
                    <NumericInput value={s.bandwidthLimitKbps} min={0} max={1000000} unit="KB/s"
                      onChange={(v) => s.set("bandwidthLimitKbps", v)} />
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader icon={<Layers size={14} />} title="Behavior" />
              <Row label="Auto SHA-256 verification" sub="Compare with sha256sum on the server after each transfer of 1 MB or more">
                <Toggle checked={s.autoVerifyChecksum} onChange={(v) => s.set("autoVerifyChecksum", v)} />
              </Row>
              <Row label="Strip metadata by default" sub="Applies to manual uploads via the Files tab (drag-drop and context menu)" last>
                <Toggle checked={s.autoStripMetadata} onChange={(v) => s.set("autoStripMetadata", v)} />
              </Row>
            </Card>
          </div>
        )}

        {tab === "terminal" && (
          <div className="space-y-4 max-w-xl">
            <div>
              <h2 className="text-base font-semibold text-slate-200">Terminal</h2>
              <p className="text-xs text-slate-500 mt-0.5">Font, shell, and behavior settings for xterm.js</p>
            </div>

            <Card>
              <div className="px-4 py-4 bg-void-950 font-mono leading-relaxed"
                style={{ fontFamily: s.termFontFamily, fontSize: `${s.termFontSize}px` }}>
                <p className="text-pylon-cyan">user<span className="text-slate-500">@</span>server<span className="text-slate-500">:~$</span> <span className="text-slate-200">ls -la</span></p>
                <p className="text-slate-400">drwxr-xr-x  4 user  staff   128 Apr 27 09:14 <span className="text-pylon-cyan">projects</span></p>
                <p className="text-slate-400">-rw-r--r--  1 user  staff  2048 Apr 27 09:12 config.yaml</p>
                <p className="text-pylon-cyan">user<span className="text-slate-500">@</span>server<span className="text-slate-500">:~$</span> <span className="text-pylon-amber">█</span></p>
              </div>
            </Card>

            <Card>
              <CardHeader icon={<Type size={14} />} title="Font" />
              <div className="px-5 pt-4 pb-2 border-b border-void-600/25">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-slate-300">Font size</p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => s.set("termFontSize", Math.max(8, s.termFontSize - 1))}
                      className="w-7 h-7 flex items-center justify-center rounded-lg bg-void-700 border border-void-600/50 text-slate-300 hover:text-white hover:bg-void-600 transition-colors font-mono">−</button>
                    <span className="w-10 text-center text-sm font-semibold text-slate-200 tabular-nums">{s.termFontSize}px</span>
                    <button onClick={() => s.set("termFontSize", Math.min(32, s.termFontSize + 1))}
                      className="w-7 h-7 flex items-center justify-center rounded-lg bg-void-700 border border-void-600/50 text-slate-300 hover:text-white hover:bg-void-600 transition-colors font-mono">+</button>
                  </div>
                </div>
                <input type="range" min={8} max={32} value={s.termFontSize}
                  onChange={(e) => s.set("termFontSize", Number(e.target.value))}
                  className="w-full accent-pylon-cyan" />
              </div>
              <div className="px-5 py-4 space-y-2">
                <p className="text-sm text-slate-300 mb-2.5">Font family</p>
                <div className="flex gap-1.5 flex-wrap mb-2">
                  {FONT_PRESETS.map((f) => (
                    <button key={f} onClick={() => s.set("termFontFamily", f)}
                      className={`px-2.5 py-1 rounded-lg text-xs border font-mono transition-all ${
                        s.termFontFamily === f
                          ? "border-pylon-cyan/50 bg-pylon-cyan/10 text-pylon-cyan"
                          : "border-void-600/60 text-slate-500 hover:text-slate-300 hover:border-void-500"
                      }`}>
                      {f.split(",")[0].replace(/"/g, "").trim()}
                    </button>
                  ))}
                </div>
                <input value={s.termFontFamily} onChange={(e) => s.set("termFontFamily", e.target.value)}
                  className={MONO_INPUT} placeholder="Custom font stack…" />
              </div>
            </Card>

            <Card>
              <CardHeader icon={<Code2 size={14} />} title="Shell" sub="Default shell launched when opening a terminal tab" />
              <div className="p-3 grid grid-cols-5 gap-2">
                {SHELL_OPTS.map((sh) => {
                  const active = s.defaultShell === sh.path;
                  return (
                    <button key={sh.path} onClick={() => s.set("defaultShell", sh.path)}
                      className={`flex flex-col gap-1 p-3 rounded-xl border transition-all text-left ${
                        active
                          ? "border-pylon-cyan/40 bg-pylon-cyan/5 text-pylon-cyan"
                          : "border-void-600/50 hover:border-void-500 text-slate-400 hover:text-slate-300 bg-void-900/20"
                      }`}>
                      <span className={`text-[13px] font-medium ${sh.path ? "font-mono" : ""}`}>{sh.label}</span>
                      <span className="text-[11px] text-slate-500">{sh.desc}</span>
                    </button>
                  );
                })}
              </div>
              <Row label="Follow the file browser" sub="Navigating the remote pane sends a cd to the active terminal">
                <Toggle checked={s.terminalFollowsBrowser} onChange={(v) => s.set("terminalFollowsBrowser", v)} />
              </Row>
              <Row label="Scrollback buffer" sub="Lines of history kept per terminal session" last>
                <NumericInput value={s.termScrollback} min={500} max={100000} unit="lines"
                  onChange={(v) => s.set("termScrollback", v)} />
              </Row>
            </Card>
          </div>
        )}

        {tab === "security" && <SecurityTab s={s} />}

        {tab === "appearance" && (
          <div className="space-y-5 max-w-2xl">
            <div>
              <h2 className="text-base font-semibold text-slate-200">Appearance</h2>
              <p className="text-xs text-slate-500 mt-0.5">Theme, layout, and visual preferences</p>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Color Theme</p>
              <div className="grid grid-cols-4 gap-2.5">
                {THEMES.map((t) => {
                  const active = s.theme === t.id;
                  return (
                    <button key={t.id} onClick={() => s.set("theme", t.id)}
                      className={`relative flex flex-col overflow-hidden rounded-lg border transition-colors ${active ? "" : "hover:!border-void-400"}`}
                      style={{
                        borderColor: active ? t.accent : "rgb(var(--void-600))",
                        boxShadow: active ? `0 0 0 1px ${t.accent}` : undefined,
                      }}>
                      <div className="h-20 w-full relative overflow-hidden" style={{ background: t.bg }}>
                        <div className="absolute left-0 top-0 bottom-0 w-7 flex flex-col gap-1 py-2 px-1" style={{ background: t.sidebar }}>
                          <div className="h-1.5 rounded-sm mx-0.5" style={{ background: t.accent + "70" }} />
                          <div className="h-1 rounded-sm mx-0.5 bg-white/10" />
                          <div className="h-1 rounded-sm mx-0.5 bg-white/10" />
                          <div className="h-1 rounded-sm mx-0.5 bg-white/10" />
                        </div>
                        <div className="absolute left-8 right-1 top-2 bottom-2 flex flex-col gap-1">
                          <div className="h-1.5 rounded-sm" style={{ background: t.accent + "80", width: "75%" }} />
                          <div className="h-1 rounded-sm bg-white/8 w-full" />
                          <div className="h-1 rounded-sm bg-white/8" style={{ width: "60%" }} />
                          <div className="h-1 rounded-sm" style={{ background: t.accent + "40", width: "45%" }} />
                          <div className="h-1 rounded-sm bg-white/8 w-full" />
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 h-3 flex items-center px-2 gap-1" style={{ background: t.sidebar }}>
                          <div className="w-1.5 h-1.5 rounded-full" style={{ background: t.accent }} />
                          <div className="h-0.5 rounded-sm flex-1 bg-white/10" />
                        </div>
                      </div>
                      <div className="px-3 py-2 text-left bg-void-800">
                        <p className="text-[11px] font-semibold text-slate-200 leading-none">{t.label}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{t.desc}</p>
                      </div>
                      {active && (
                        <div className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center shadow-lg"
                          style={{ background: t.accent }}>
                          <Check size={10} className="text-black font-bold" />
                        </div>
                      )}
                    </button>
                  );
                })}

              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Layout</p>
              <Card>
                <div className="px-5 py-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-300">Sidebar width</p>
                      <p className="text-xs text-slate-500 mt-0.5">Width when sidebar is expanded (140–400 px)</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="range" min={140} max={400} value={s.sidebarWidth}
                        onChange={(e) => s.set("sidebarWidth", Number(e.target.value))}
                        className="w-28 accent-pylon-cyan" />
                      <NumericInput value={s.sidebarWidth} min={140} max={400} unit="px"
                        onChange={(v) => s.set("sidebarWidth", v)} />
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        )}

        {tab === "general" && (
          <div className="space-y-4 max-w-xl">
            <div>
              <h2 className="text-base font-semibold text-slate-200">General</h2>
              <p className="text-xs text-slate-500 mt-0.5">Workspace defaults and connection behavior</p>
            </div>

            <Card>
              <CardHeader icon={<FolderOpen size={14} />} title="Workspace" />
              <div className="px-5 py-4 space-y-2">
                <p className="text-sm text-slate-300">Default local path</p>
                <p className="text-xs text-slate-500">Starting directory for the local file pane (leave empty to use home)</p>
                <input value={s.defaultLocalPath} onChange={(e) => s.set("defaultLocalPath", e.target.value)}
                  placeholder="e.g. /home/user/projects" className={MONO_INPUT} />
              </div>
            </Card>

            <Card>
              <CardHeader icon={<Server size={14} />} title="Connection" />
              <Row label="Auto-reconnect" sub="Reconnect ZVault sessions automatically if the connection drops">
                <Toggle checked={s.autoReconnect} onChange={(v) => s.set("autoReconnect", v)} />
              </Row>
              <Row label="Confirm before deleting" sub="Ask before deleting local or remote files" last>
                <Toggle checked={s.confirmDeletes} onChange={(v) => s.set("confirmDeletes", v)} />
              </Row>
            </Card>

            <div className="pt-2">
              <button onClick={async () => { if (await confirmDialog({ title: "Reset all settings?", message: "Every preference returns to its default. Saved servers, bookmarks and the vault are not affected.", confirmLabel: "Reset", danger: true })) s.reset(); }}
                className="px-3 py-1.5 rounded-md border border-pylon-red/35 text-pylon-red text-xs hover:bg-pylon-red/10 transition-colors">
                Reset all settings to defaults
              </button>
            </div>
          </div>
        )}

        {tab === "about" && (
          <div className="space-y-4 max-w-lg">
            <div className="relative overflow-hidden rounded-2xl border border-pylon-cyan/20 p-6"
              style={{ background: "linear-gradient(135deg, #07090f 0%, #0d1520 100%)" }}>
              <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-pylon-cyan/6 blur-2xl pointer-events-none" />
              <div className="absolute -bottom-6 -left-6 w-28 h-28 rounded-full bg-pylon-violet/6 blur-xl pointer-events-none" />
              <div className="relative flex items-center gap-4">
                <img src="/pylon-icon.png" alt="Pylon" className="w-14 h-14 rounded-2xl shadow-xl" />
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h1 className="text-xl font-bold text-slate-100 tracking-tight">Pylon</h1>
                    <span className="px-2 py-0.5 rounded-full bg-pylon-cyan/12 border border-pylon-cyan/25 text-[10px] font-mono text-pylon-cyan tracking-wider">v{version || "…"}</span>
                  </div>
                  <p className="text-sm text-slate-400">Open-source SSH &amp; SFTP client</p>
                  <p className="text-xs text-slate-600 mt-0.5">© 2026 TheHolyOneZ · GPL-3.0</p>
                </div>
              </div>
            </div>

            <Card>
              <CardHeader icon={<Globe size={14} />} title="Links" />
              <div className="divide-y divide-void-600/30">
                {[
                  { label: "Developer",      sub: "github.com/TheHolyOneZ",          url: "https://github.com/TheHolyOneZ/" },
                  { label: "Pylon on GitHub", sub: "github.com/TheHolyOneZ/Pylon",   url: "https://github.com/TheHolyOneZ/Pylon" },
                  { label: "More projects",  sub: "zsync.eu",                         url: "https://zsync.eu/" },
                ].map((link) => (
                  <button key={link.url} onClick={() => openUrl(link.url)}
                    className="w-full flex items-center justify-between px-5 py-3 hover:bg-void-700/30 transition-colors text-left group">
                    <div>
                      <p className="text-sm text-slate-300 group-hover:text-pylon-cyan transition-colors">{link.label}</p>
                      <p className="text-xs text-slate-600 font-mono mt-0.5">{link.sub}</p>
                    </div>
                    <ChevronRight size={13} className="text-slate-600 group-hover:text-pylon-cyan transition-colors" />
                  </button>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader icon={<Package size={14} />} title="Stack" />
              <div className="px-5 py-4 flex flex-wrap gap-1.5">
                {[
                  { label: "Tauri v2",       color: "text-pylon-amber border-pylon-amber/30 bg-pylon-amber/6" },
                  { label: "Rust",           color: "text-orange-400 border-orange-900/40 bg-orange-900/10" },
                  { label: "React 19",       color: "text-cyan-400 border-cyan-900/30 bg-cyan-900/8" },
                  { label: "TypeScript",     color: "text-blue-400 border-blue-900/30 bg-blue-900/8" },
                  { label: "Zustand",        color: "text-slate-300 border-void-600 bg-void-700" },
                  { label: "Framer Motion",  color: "text-pink-400 border-pink-900/30 bg-pink-900/8" },
                  { label: "xterm.js",       color: "text-pylon-green border-pylon-green/25 bg-pylon-green/6" },
                  { label: "ssh2",           color: "text-slate-400 border-void-600 bg-void-700" },
                  { label: "AES-256-GCM",    color: "text-pylon-cyan border-pylon-cyan/25 bg-pylon-cyan/6" },
                  { label: "Argon2id",       color: "text-pylon-cyan border-pylon-cyan/20 bg-pylon-cyan/5" },
                  { label: "SHA-256",        color: "text-pylon-cyan border-pylon-cyan/20 bg-pylon-cyan/5" },
                ].map((t) => (
                  <span key={t.label} className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${t.color}`}>{t.label}</span>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader icon={<Layers size={14} />} title="Keyboard Shortcuts" />
              <div className="px-5 py-4 grid grid-cols-2 gap-x-6 gap-y-2">
                {[
                  ["Ctrl + N",       "New connection"],
                  ["Ctrl + D",       "Disconnect active"],
                  ["Ctrl + T",       "Transfer drawer"],
                  ["Ctrl + K",       "Command palette"],
                  ["Ctrl + A",       "Select all files"],
                  ["Ctrl + F",       "Focus file filter"],
                  ["F5",             "Refresh both panes"],
                  ["Ctrl+Shift+T",   "New terminal tab"],
                ].map(([key, desc]) => (
                  <div key={key} className="flex items-center gap-2">
                    <kbd className="shrink-0 px-1.5 py-0.5 rounded-md bg-void-700 border border-void-600/60 text-[10px] text-slate-400 font-mono">{key}</kbd>
                    <span className="text-xs text-slate-500">{desc}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

      </div>
    </div>
  );
}

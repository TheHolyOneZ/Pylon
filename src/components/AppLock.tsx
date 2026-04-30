import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Shield } from "lucide-react";

const LOCK_KEY = "pylon-app-lock-hash";
const SETUP_KEY = "pylon-app-lock-setup-done";


async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function setLockPassword(password: string) {
  const hash = await sha256(password + "pylon-lock-v1");
  localStorage.setItem(LOCK_KEY, hash);
}

export async function checkLockPassword(password: string): Promise<boolean> {
  const stored = localStorage.getItem(LOCK_KEY);
  if (!stored) return true;
  const hash = await sha256(password + "pylon-lock-v1");
  return hash === stored;
}

export function clearLockPassword() {
  localStorage.removeItem(LOCK_KEY);
  localStorage.removeItem(SETUP_KEY);
}

export function hasLockPassword(): boolean {
  return !!localStorage.getItem(LOCK_KEY);
}

function isFirstLaunch(): boolean {
  return !localStorage.getItem(SETUP_KEY);
}

function markSetupDone() {
  localStorage.setItem(SETUP_KEY, "1");
}


function SetupScreen({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function handleSet() {
    if (pw.length < 4) { setErr("Password must be at least 4 characters"); return; }
    if (pw !== confirm) { setErr("Passwords don't match"); return; }
    await setLockPassword(pw);
    markSetupDone();
    onDone();
  }

  function handleSkip() {
    markSetupDone();
    onDone();
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-6 w-full max-w-sm"
    >
      <div className="flex flex-col items-center gap-3">
        <img src="/pylon-icon.png" alt="Pylon" className="w-14 h-14 rounded-2xl shadow-lg shadow-pylon-cyan/20" />
        <h1 className="text-xl font-bold text-slate-100">Welcome to Pylon</h1>
        <p className="text-sm text-slate-500 text-center">
          Set an app lock password to protect access. You can skip this and enable it later in Settings.
        </p>
      </div>

      <div className="w-full space-y-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Password</label>
          <input
            ref={inputRef}
            type="password"
            value={pw}
            onChange={(e) => { setPw(e.target.value); setErr(""); }}
            placeholder="Enter a password"
            className="w-full bg-void-800 border border-void-600 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-pylon-cyan/50"
            onKeyDown={(e) => e.key === "Enter" && handleSet()}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Confirm</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => { setConfirm(e.target.value); setErr(""); }}
            placeholder="Repeat password"
            className="w-full bg-void-800 border border-void-600 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-pylon-cyan/50"
            onKeyDown={(e) => e.key === "Enter" && handleSet()}
          />
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
      </div>

      <div className="flex gap-3 w-full">
        <button
          onClick={handleSkip}
          className="flex-1 py-2.5 rounded-lg border border-void-600 text-sm text-slate-400 hover:text-slate-200 hover:bg-void-700 transition-colors"
        >
          Skip for now
        </button>
        <button
          onClick={handleSet}
          disabled={!pw}
          className="flex-1 py-2.5 rounded-lg bg-pylon-cyan/10 border border-pylon-cyan/30 text-sm text-pylon-cyan hover:bg-pylon-cyan/20 transition-colors disabled:opacity-40"
        >
          <Shield size={13} className="inline mr-1.5" />
          Set password
        </button>
      </div>
    </motion.div>
  );
}


function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [shaking, setShaking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function handleUnlock() {
    const ok = await checkLockPassword(pw);
    if (ok) {
      onUnlock();
    } else {
      setErr("Wrong password");
      setPw("");
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-6 w-full max-w-xs"
    >
      <div className="flex flex-col items-center gap-3">
        <img src="/pylon-icon.png" alt="Pylon" className="w-14 h-14 rounded-2xl shadow-lg shadow-pylon-cyan/20" />
        <Lock size={18} className="text-pylon-cyan" />
        <h1 className="text-lg font-bold text-slate-100">Pylon is locked</h1>
      </div>

      <motion.div
        animate={shaking ? { x: [-8, 8, -8, 8, 0] } : {}}
        transition={{ duration: 0.4 }}
        className="w-full"
      >
        <input
          ref={inputRef}
          type="password"
          value={pw}
          onChange={(e) => { setPw(e.target.value); setErr(""); }}
          placeholder="Enter app password"
          className="w-full bg-void-800 border border-void-600 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-pylon-cyan/50 text-center tracking-widest"
          onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
        />
        {err && <p className="text-xs text-red-400 mt-1.5 text-center">{err}</p>}
      </motion.div>

      <button
        onClick={handleUnlock}
        disabled={!pw}
        className="w-full py-2.5 rounded-lg bg-pylon-cyan/10 border border-pylon-cyan/30 text-sm text-pylon-cyan hover:bg-pylon-cyan/20 transition-colors disabled:opacity-40"
      >
        Unlock
      </button>
    </motion.div>
  );
}


interface AppLockProps {
  children: React.ReactNode;
}

export function AppLock({ children }: AppLockProps) {
  const [phase, setPhase] = useState<"loading" | "setup" | "locked" | "open">("loading");

  useEffect(() => {
    if (isFirstLaunch()) {
      setPhase("setup");
    } else if (hasLockPassword()) {
      setPhase("locked");
    } else {
      setPhase("open");
    }
  }, []);

  if (phase === "loading") return null;

  if (phase === "open") return <>{children}</>;

  return (
    <AnimatePresence mode="wait">
      {(phase === "setup" || phase === "locked") && (
        <motion.div
          key="lock"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-void-950"
        >
          {}
          <div
            className="absolute inset-0 opacity-5"
            style={{ backgroundImage: "radial-gradient(circle, #00e5ff 1px, transparent 1px)", backgroundSize: "32px 32px" }}
          />
          <div className="relative z-10 px-8">
            {phase === "setup" ? (
              <SetupScreen onDone={() => setPhase("open")} />
            ) : (
              <LockScreen onUnlock={() => setPhase("open")} />
            )}
          </div>
        </motion.div>
      )}
      {phase !== "setup" && phase !== "locked" && <motion.div key="app" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{children}</motion.div>}
    </AnimatePresence>
  );
}

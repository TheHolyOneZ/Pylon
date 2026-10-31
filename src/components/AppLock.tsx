import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Lock } from "lucide-react";
import { Button, Input, PylonMark } from "./ui/primitives";

const LOCK_KEY = "pylon-app-lock-hash";
const LEGACY_SETUP_KEY = "pylon-app-lock-setup-done";
const ITERATIONS = 310_000;

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key: string, value: string | null) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { }
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

async function legacySha256(password: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password + "pylon-lock-v1"));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export async function setLockPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  storageSet(LOCK_KEY, `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(hash)}`);
}

export async function checkLockPassword(password: string): Promise<boolean> {
  const stored = storageGet(LOCK_KEY);
  if (!stored) return true;
  if (stored.startsWith("pbkdf2$")) {
    const [, iter, salt, hash] = stored.split("$");
    const got = await pbkdf2(password, unb64(salt), Number(iter) || ITERATIONS);
    return constantTimeEqual(got, unb64(hash));
  }
  const ok = (await legacySha256(password)) === stored;
  if (ok) await setLockPassword(password);
  return ok;
}

export function clearLockPassword() {
  storageSet(LOCK_KEY, null);
  storageSet(LEGACY_SETUP_KEY, null);
}

export function hasLockPassword(): boolean {
  return !!storageGet(LOCK_KEY);
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function unlock(e?: React.FormEvent) {
    e?.preventDefault();
    if (!pw || busy) return;
    setBusy(true);
    const ok = await checkLockPassword(pw).catch(() => false);
    setBusy(false);
    if (ok) return onUnlock();
    setErr("Incorrect password");
    setPw("");
    setShake((n) => n + 1);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-void-950" data-tauri-drag-region>
      <motion.form
        onSubmit={unlock}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        className="flex w-[320px] flex-col items-center"
      >
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-void-600 bg-void-800 text-pylon-cyan">
          <PylonMark size={24} />
        </div>
        <h1 className="text-[15px] font-semibold text-slate-100">Pylon is locked</h1>
        <p className="mb-5 mt-1 text-xs text-slate-500">Enter your app password to continue.</p>
        <motion.div key={shake} animate={shake ? { x: [0, -6, 6, -4, 4, 0] } : {}} transition={{ duration: 0.32 }} className="w-full">
          <Input
            ref={inputRef}
            type="password"
            value={pw}
            onChange={(e) => { setPw(e.target.value); setErr(""); }}
            placeholder="Password"
            aria-invalid={!!err}
            className={err ? "!border-pylon-red/60" : ""}
          />
        </motion.div>
        <p className="mt-1.5 h-4 self-start text-xs text-pylon-red">{err}</p>
        <Button type="submit" variant="primary" className="mt-2 w-full justify-center" disabled={!pw || busy}>
          <Lock size={13} /> {busy ? "Checking…" : "Unlock"}
        </Button>
      </motion.form>
    </div>
  );
}

export function AppLock({ children }: { children: React.ReactNode }) {
  const [locked, setLocked] = useState(hasLockPassword);
  return locked ? <LockScreen onUnlock={() => setLocked(false)} /> : <>{children}</>;
}

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { checkLockPassword } from "../AppLock";
import { Button, Field, Input, Modal, ModalBody, ModalFooter } from "./primitives";

interface PromptOptions {
  title?: string;
  description?: string;
}

type PromptFn = (opts?: PromptOptions) => Promise<boolean>;

const LockPasswordContext = createContext<PromptFn>(() => Promise.resolve(false));

export function useLockPasswordPrompt() {
  return useContext(LockPasswordContext);
}

export function LockPasswordProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<PromptOptions | null>(null);
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const prompt: PromptFn = useCallback((options) => {
    resolveRef.current?.(false);
    setPw("");
    setError("");
    setBusy(false);
    setOpts(options ?? {});
    return new Promise((resolve) => { resolveRef.current = resolve; });
  }, []);

  function finish(ok: boolean) {
    setOpts(null);
    resolveRef.current?.(ok);
    resolveRef.current = null;
  }

  async function confirm(e?: React.FormEvent) {
    e?.preventDefault();
    if (!pw || busy) return;
    setBusy(true);
    const ok = await checkLockPassword(pw).catch(() => false);
    setBusy(false);
    if (ok) return finish(true);
    setError("Incorrect password");
    setPw("");
  }

  return (
    <LockPasswordContext.Provider value={prompt}>
      {children}
      {opts && (
        <Modal onClose={() => finish(false)} title={opts.title ?? "Confirm with app password"} icon={<Lock size={15} />} width={380}>
          <form onSubmit={confirm}>
            <ModalBody>
              <p className="mb-3 text-[13px] text-slate-400">{opts.description ?? "Enter your app lock password to continue."}</p>
              <Field error={error || null}>
                <Input autoFocus type="password" value={pw} onChange={(e) => { setPw(e.target.value); setError(""); }} placeholder="App password" />
              </Field>
            </ModalBody>
            <ModalFooter>
              <Button type="button" variant="ghost" onClick={() => finish(false)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={!pw || busy}>{busy ? "Checking…" : "Confirm"}</Button>
            </ModalFooter>
          </form>
        </Modal>
      )}
    </LockPasswordContext.Provider>
  );
}

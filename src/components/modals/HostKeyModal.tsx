import { useCallback, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { ShieldAlert, ShieldQuestion } from "lucide-react";
import { Button, Callout, Modal, ModalBody, ModalFooter } from "../ui/primitives";
import { HostKeyVerification, ConnectionInfo } from "../../types";
import { useConnectionStore } from "../../stores/connectionStore";
import type { AuthArgs } from "../../lib/tauri";
import { errMsg } from "../../lib/format";

interface Props {
  host: string;
  port: number;
  fingerprint: string;
  oldFingerprint?: string | null;
  keyType: string;
  changed: boolean;
  busy?: boolean;
  error?: string | null;
  onAccept: (permanent: boolean) => void;
  onReject: () => void;
}

function Fingerprint({ label, value, tone }: { label: string; value: string; tone?: "old" | "new" }) {
  return (
    <div className="rounded-lg border border-void-600 bg-void-950/50 px-3 py-2.5">
      <div className="mb-1 text-[11px] font-medium text-slate-500">{label}</div>
      <code className={`selectable block break-all font-mono text-[12.5px] leading-relaxed ${tone === "old" ? "text-slate-500 line-through" : "text-slate-100"}`}>{value}</code>
    </div>
  );
}

export function HostKeyModal({ host, port, fingerprint, oldFingerprint, keyType, changed, busy, error, onAccept, onReject }: Props) {
  const target = port === 22 ? host : `${host}:${port}`;
  return (
    <Modal
      onClose={onReject}
      width={500}
      icon={changed ? <ShieldAlert size={16} className="text-pylon-red" /> : <ShieldQuestion size={16} className="text-pylon-amber" />}
      title={changed ? "Server identity has changed" : "Verify the server's identity"}
      subtitle={target}
    >
      <ModalBody className="space-y-3">
        {changed ? (
          <Callout tone="danger">
            The host key for <strong className="font-semibold">{target}</strong> is different from the one saved in
            known_hosts. This happens when a server is reinstalled — or when someone is intercepting the connection.
            Only continue if you know why the key changed.
          </Callout>
        ) : (
          <p className="text-[13px] leading-relaxed text-slate-300">
            This is the first time you connect to <strong className="font-medium text-slate-100">{target}</strong>. Compare
            the fingerprint below with the one your server administrator gave you (or run{" "}
            <code className="rounded bg-void-700 px-1 font-mono text-xs">ssh-keygen -lf /etc/ssh/ssh_host_*_key.pub</code> on the server).
          </p>
        )}
        {changed && oldFingerprint && <Fingerprint label="Previously saved key" value={oldFingerprint} tone="old" />}
        <Fingerprint label={`${keyType} key fingerprint${changed ? " (presented now)" : ""}`} value={fingerprint} />
        {error && <Callout tone="danger">{error}</Callout>}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onReject} disabled={busy} data-autofocus={changed ? true : undefined}>Cancel</Button>
        <Button variant={changed ? "danger-ghost" : "secondary"} onClick={() => onAccept(false)} loading={busy} title="Connect without saving the key">
          Connect once
        </Button>
        <Button variant={changed ? "danger" : "primary"} onClick={() => onAccept(true)} disabled={busy} data-autofocus={changed ? undefined : true}>
          {changed ? "Replace saved key" : "Trust and connect"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

type Target = { credentialId: string } | { quick: AuthArgs & { label: string } };

export function useHostKeyFlow() {
  const [state, setState] = useState<{ v: HostKeyVerification; target: Target } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((info: ConnectionInfo | null) => void) | null>(null);

  const prompt = useCallback((v: HostKeyVerification, target: Target) => {
    setError(null);
    setState({ v, target });
    return new Promise<ConnectionInfo | null>((resolve) => { resolver.current = resolve; });
  }, []);

  const finish = (info: ConnectionInfo | null) => {
    resolver.current?.(info);
    resolver.current = null;
    setState(null);
  };

  async function accept(permanent: boolean) {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      const store = useConnectionStore.getState();
      const info = "credentialId" in state.target
        ? await store.acceptVault(state.target.credentialId, state.v.fingerprint, permanent)
        : await store.acceptQuick(state.target.quick, state.v.fingerprint, permanent);
      finish(info);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const element = (
    <AnimatePresence>
      {state && (
        <HostKeyModal
          key="hostkey"
          host={state.v.host}
          port={state.v.port}
          fingerprint={state.v.fingerprint}
          oldFingerprint={state.v.old_fingerprint}
          keyType={state.v.key_type}
          changed={state.v.status === "changed"}
          busy={busy}
          error={error}
          onAccept={accept}
          onReject={() => finish(null)}
        />
      )}
    </AnimatePresence>
  );

  return { prompt, element, open: !!state };
}

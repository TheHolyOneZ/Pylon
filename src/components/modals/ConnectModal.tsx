import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronRight, Info, KeyRound, Server, X, Zap } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";
import { useServerStore } from "../../stores/serverStore";
import { toast } from "../../stores/toastStore";
import * as api from "../../lib/tauri";
import { errMsg } from "../../lib/format";
import { SshConfigHost } from "../../types";
import { HostKeyModal } from "./HostKeyModal";

type AuthMode = "password" | "key" | "agent";

const INPUT = "w-full bg-void-900 border border-void-500 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-pylon-cyan/50 transition-colors";

export function ConnectModal() {
  const { setConnectModal, connectPrefill } = useUiStore();
  const { connectToServer } = useConnectionStore();
  const { save: saveServer } = useServerStore();

  const [host, setHost] = useState(connectPrefill?.host ?? "");
  const [port, setPort] = useState(String(connectPrefill?.port ?? 22));
  const [username, setUsername] = useState(connectPrefill?.username ?? "");
  const [label, setLabel] = useState(connectPrefill?.label ?? "");
  const [authMode, setAuthMode] = useState<AuthMode>(connectPrefill?.authType ?? "password");
  const [password, setPassword] = useState(connectPrefill?.savedPassword ?? "");
  const [privateKey, setPrivateKey] = useState("");
  const [privateKeyPath, setPrivateKeyPath] = useState(connectPrefill?.keyPath ?? "");
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; latency?: number; msg?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [saveToServers, setSaveToServers] = useState(false);
  const [savePassword, setSavePassword] = useState(false);
  const [timeout, setTimeout_] = useState<number | null>(connectPrefill?.timeout ?? null);
  const [pendingHostKey, setPendingHostKey] = useState<null | {
    host: string; port: number; fingerprint: string; keyType: string; changed: boolean;
  }>(null);


  const [configHosts, setConfigHosts] = useState<SshConfigHost[]>([]);
  const [showConfigPicker, setShowConfigPicker] = useState(false);

  useEffect(() => {
    api.listSshConfigHosts().then(setConfigHosts).catch(() => {});
  }, []);

  function applyConfigHost(h: SshConfigHost) {
    if (h.hostname) setHost(h.hostname);
    if (h.user) setUsername(h.user);
    if (h.port) setPort(String(h.port));
    if (!label) setLabel(h.alias);
    if (h.identity_file) { setAuthMode("key"); setPrivateKeyPath(h.identity_file); }
    setShowConfigPicker(false);
  }

  async function browseKeyFile() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "PEM Keys", extensions: ["pem", "key", "rsa", "ed25519", "ecdsa"] }],
      });
      if (typeof selected === "string") setPrivateKeyPath(selected);
    } catch {

    }
  }

  async function handleTest() {
    setTesting(true); setTestResult(null);
    const start = Date.now();
    try {
      await api.testConnection({
        host, port: parseInt(port), username,
        password: authMode === "password" ? password : undefined,
        privateKey: authMode === "key" ? (privateKey || privateKeyPath) : undefined,
      });
      setTestResult({ ok: true, latency: Date.now() - start });
    } catch (e: any) {
      setTestResult({ ok: false, msg: errMsg(e) });
    } finally {
      setTesting(false);
    }
  }

  function currentLabel() {
    return label.trim() || `${username}@${host}`;
  }

  async function finishConnect(info: import("../../types").ConnectionInfo) {
    if (saveToServers) {

      saveServer({
        id: connectPrefill?.id ?? info.id,
        label: info.label,
        host: info.host,
        port: info.port,
        username: info.username,
        authType: authMode,
        keyPath: authMode === "key" ? privateKeyPath : undefined,
        savedPassword: (savePassword && authMode === "password") ? password : undefined,
        timeout,
        lastConnected: new Date().toISOString(),
      });
    }
    setConnectModal(false);
    toast.success("Connected", `${info.label} — ${info.host}`);
  }

  async function handleConnect() {
    setConnecting(true); setError(null);
    try {
      const info = await connectToServer(
        host, parseInt(port), username,
        authMode === "password" ? password : undefined,
        authMode === "key" ? (privateKey || privateKeyPath) : undefined,
        currentLabel()
      );
      await finishConnect(info);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      const verification = (e as any).verification;
      if (msg === "host_key_unknown") {
        setPendingHostKey({
          host, port: parseInt(port),
          fingerprint: verification?.fingerprint ?? "unknown",
          keyType: verification?.key_type ?? "unknown",
          changed: false,
        });
      } else if (msg === "host_key_changed") {
        setPendingHostKey({
          host, port: parseInt(port),
          fingerprint: verification?.fingerprint ?? "unknown",
          keyType: verification?.key_type ?? "unknown",
          changed: true,
        });
      } else {
        setError(msg);
      }
    } finally {
      setConnecting(false);
    }
  }

  async function handleHostKeyAccept(permanent: boolean) {
    if (!pendingHostKey) return;
    setPendingHostKey(null);
    setConnecting(true); setError(null);
    try {
      const info = await api.acceptHostKeyAndConnect({
        host: pendingHostKey.host,
        port: pendingHostKey.port,
        username,
        password: authMode === "password" ? password : undefined,
        privateKey: authMode === "key" ? (privateKey || privateKeyPath) : undefined,
        label: currentLabel(),
        permanent,
      });

      useConnectionStore.getState().addConnection(info);
      await finishConnect(info);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setConnecting(false);
    }
  }


  if (pendingHostKey) {
    return (
      <HostKeyModal
        host={pendingHostKey.host}
        port={pendingHostKey.port}
        fingerprint={pendingHostKey.fingerprint}
        keyType={pendingHostKey.keyType}
        changed={pendingHostKey.changed}
        onAccept={handleHostKeyAccept}
        onReject={() => { setPendingHostKey(null); setConnectModal(false); }}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={() => setConnectModal(false)}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        className="w-[480px] bg-void-800 border border-void-500 rounded-xl shadow-2xl overflow-hidden"
      >
        {}
        <div className="flex items-center gap-3 px-5 py-4 bg-void-900 border-b border-void-600">
          <Server size={15} className="text-pylon-cyan" />
          <div>
            <span className="text-sm font-semibold text-slate-200">Quick Connect</span>
            <div className="flex items-center gap-1 mt-0.5">
              <Info size={10} className="text-slate-600" />
              <span className="text-[10px] text-slate-600">Session only — use ZVault to save credentials permanently</span>
            </div>
          </div>
          <div className="flex-1" />
          {configHosts.length > 0 && (
            <button
              onClick={() => setShowConfigPicker((v) => !v)}
              className="text-xs px-2 py-1 rounded border border-void-500 text-slate-500 hover:text-slate-300 hover:bg-void-700 transition-colors flex items-center gap-1"
            >
              <KeyRound size={10} /> SSH Config
            </button>
          )}
          <button onClick={() => setConnectModal(false)} className="p-1 rounded hover:bg-void-700 text-slate-500 hover:text-slate-200 transition-colors">
            <X size={14} />
          </button>
        </div>

        {}
        <AnimatePresence>
          {showConfigPicker && configHosts.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-b border-void-600 bg-void-900/50"
            >
              <div className="px-4 py-2 space-y-0.5 max-h-36 overflow-y-auto">
                <p className="text-[10px] text-slate-600 font-semibold uppercase tracking-wider mb-1">Import from ~/.ssh/config</p>
                {configHosts.map((h) => (
                  <button key={h.alias} onClick={() => applyConfigHost(h)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-slate-300 hover:bg-void-700 transition-colors text-left">
                    <Server size={11} className="text-pylon-cyan shrink-0" />
                    <span className="font-medium">{h.alias}</span>
                    <span className="text-slate-600">{h.user && `${h.user}@`}{h.hostname ?? ""}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="p-5 space-y-4 overflow-y-auto max-h-[70vh]">
          {}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-500 mb-1">Host</label>
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.1" className={INPUT} />
            </div>
            <div className="w-20">
              <label className="block text-xs text-slate-500 mb-1">Port</label>
              <input value={port} onChange={(e) => setPort(e.target.value)} className={INPUT} />
            </div>
          </div>

          {}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-500 mb-1">Username</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="root" className={INPUT} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-500 mb-1">Label (optional)</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="My Server" className={INPUT} />
            </div>
          </div>

          {}
          <div>
            <label className="block text-xs text-slate-500 mb-2">Authentication</label>
            <div className="flex gap-1 bg-void-900 p-1 rounded-lg">
              {(["password", "key", "agent"] as AuthMode[]).map((mode) => (
                <button key={mode} onClick={() => setAuthMode(mode)}
                  className={`flex-1 py-1.5 rounded text-xs font-medium capitalize transition-all ${
                    authMode === mode
                      ? "bg-pylon-cyan/10 text-pylon-cyan border border-pylon-cyan/20"
                      : "text-slate-500 hover:text-slate-300"
                  }`}>
                  {mode === "key" ? "SSH Key" : mode}
                </button>
              ))}
            </div>
          </div>

          {authMode === "password" && (
            <div>
              <label className="block text-xs text-slate-500 mb-1">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT} />
            </div>
          )}

          {authMode === "key" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <label className="block text-xs text-slate-500">Key File</label>
                <button onClick={browseKeyFile} className="text-[10px] px-2 py-0.5 rounded border border-void-500 text-pylon-cyan hover:bg-pylon-cyan/10 transition-colors">
                  Browse…
                </button>
              </div>
              {privateKeyPath && (
                <p className="text-xs font-mono text-pylon-cyan/70 truncate">{privateKeyPath}</p>
              )}
              <textarea
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="Or paste PEM key here…"
                rows={3}
                className={`${INPUT} text-xs font-mono resize-none`}
              />
            </div>
          )}

          {authMode === "agent" && (
            <div className="flex items-center gap-2 px-3 py-2 bg-void-900 rounded-lg border border-void-500 text-xs text-slate-500">
              <KeyRound size={13} /> Will use your SSH agent automatically
            </div>
          )}

          {}
          {testResult && (
            <div className={`px-3 py-2 rounded-lg border text-xs ${
              testResult.ok
                ? "bg-pylon-green/10 border-pylon-green/20 text-pylon-green"
                : "bg-pylon-red/10 border-pylon-red/20 text-pylon-red"
            }`}>
              {testResult.ok ? `Connected · ${testResult.latency}ms latency` : testResult.msg}
            </div>
          )}

          {error && (
            <div className="px-3 py-2 bg-pylon-red/10 border border-pylon-red/20 rounded-lg text-xs text-pylon-red">
              {error}
            </div>
          )}

          {}
          <div>
            <button onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">
              {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Advanced
            </button>
            <AnimatePresence>
              {showAdvanced && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="pt-3 space-y-3 text-xs text-slate-500 bg-void-900/50 rounded-lg px-3 py-3 mt-2">
                    <p>Keep-alive interval: <span className="text-slate-300">25s</span></p>
                    <p>Host key policy: <span className="text-slate-300">Ask (known_hosts)</span></p>
                    <p>Chunk size: <span className="text-slate-300">512 KiB</span></p>
                    <div className="flex items-center gap-2">
                      <span>Auto-disconnect:</span>
                      <select
                        value={timeout ?? ""}
                        onChange={(e) => setTimeout_(e.target.value ? Number(e.target.value) : null)}
                        className="bg-void-800 border border-void-500 rounded px-2 py-1 text-slate-300 text-xs outline-none"
                      >
                        <option value="">Never</option>
                        <option value="1">1 min</option>
                        <option value="5">5 min</option>
                        <option value="10">10 min</option>
                        <option value="30">30 min</option>
                      </select>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {}
          <div className="bg-void-900/60 rounded-lg px-3 py-2.5 border border-void-600 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={saveToServers}
                onChange={(e) => setSaveToServers(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-pylon-cyan"
              />
              <span className="text-xs text-slate-300">Save to My Servers (sidebar)</span>
            </label>
            {saveToServers && authMode === "password" && (
              <label className="flex items-center gap-2 cursor-pointer select-none pl-5">
                <input
                  type="checkbox"
                  checked={savePassword}
                  onChange={(e) => setSavePassword(e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-pylon-cyan"
                />
                <span className="text-xs text-slate-500">
                  Save password <span className="text-slate-700">(blurred, app-lock protected)</span>
                </span>
              </label>
            )}
          </div>

          {}
          <div className="flex gap-2">
            <button onClick={handleTest} disabled={testing || !host || !username}
              className="px-4 py-2.5 rounded-lg border border-void-500 text-slate-400 text-sm hover:text-slate-200 hover:bg-void-700 transition-colors disabled:opacity-40 flex items-center gap-1.5">
              {testing ? <span className="w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin" /> : null}
              Test
            </button>
            <button onClick={handleConnect} disabled={connecting || !host || !username}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-pylon-cyan/10 border border-pylon-cyan/30 text-pylon-cyan text-sm font-medium hover:bg-pylon-cyan/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              {connecting ? (
                <><span className="w-3 h-3 border border-pylon-cyan border-t-transparent rounded-full animate-spin" /> Connecting…</>
              ) : (
                <><Zap size={14} /> Connect</>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

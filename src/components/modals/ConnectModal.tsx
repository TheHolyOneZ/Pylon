import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { CheckCircle2, ChevronDown, FileKey, FolderOpen, Info, KeyRound, Plug, Server, XCircle } from "lucide-react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";
import { useServerStore } from "../../stores/serverStore";
import { toast } from "../../stores/toastStore";
import * as api from "../../lib/tauri";
import type { AuthArgs, TestResult } from "../../lib/tauri";
import { errMsg } from "../../lib/format";
import { SshConfigHost } from "../../types";
import { useHostKeyFlow } from "./HostKeyModal";
import { Button, Callout, Field, Input, Modal, ModalBody, ModalFooter, Segmented } from "../ui/primitives";
import { ContextMenu } from "../files/ContextMenu";
import { AnimatePresence } from "framer-motion";

type AuthMode = "password" | "key" | "agent";

export function ConnectModal() {
  const { setConnectModal, connectPrefill } = useUiStore();
  const { connectQuick } = useConnectionStore();
  const { save: saveServer } = useServerStore();
  const hostKey = useHostKeyFlow();

  const [host, setHost] = useState(connectPrefill?.host ?? "");
  const [port, setPort] = useState(String(connectPrefill?.port ?? 22));
  const [username, setUsername] = useState(connectPrefill?.username ?? "");
  const [label, setLabel] = useState(connectPrefill?.label ?? "");
  const [authMode, setAuthMode] = useState<AuthMode>(connectPrefill?.authType ?? "password");
  const [password, setPassword] = useState(connectPrefill?.savedPassword ?? "");
  const [keyPath, setKeyPath] = useState(connectPrefill?.keyPath ?? "");
  const [keyText, setKeyText] = useState("");
  const [pasteKey, setPasteKey] = useState(false);
  const [keyPassphrase, setKeyPassphrase] = useState("");
  const [saveToServers, setSaveToServers] = useState(!!connectPrefill);
  const [savePassword, setSavePassword] = useState(!!connectPrefill?.savedPassword);

  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configHosts, setConfigHosts] = useState<SshConfigHost[]>([]);
  const [configMenu, setConfigMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    api.listSshConfigHosts().then(setConfigHosts).catch(() => {});
  }, []);

  const portNum = Number(port);
  const portValid = Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535;
  const canSubmit = host.trim() !== "" && username.trim() !== "" && portValid && (authMode !== "key" || (pasteKey ? keyText.trim() : keyPath.trim()) !== "");

  const args = useMemo((): AuthArgs & { label: string } => ({
    host: host.trim(),
    port: portNum,
    username: username.trim(),
    password: authMode === "password" ? password : undefined,
    privateKey: authMode === "key" ? (pasteKey ? keyText : keyPath.trim()) : undefined,
    keyPassphrase: authMode === "key" && keyPassphrase ? keyPassphrase : undefined,
    label: label.trim() || `${username.trim()}@${host.trim()}`,
  }), [host, portNum, username, authMode, password, pasteKey, keyText, keyPath, keyPassphrase, label]);

  function applyConfigHost(h: SshConfigHost) {
    setHost(h.hostname ?? h.alias);
    if (h.user) setUsername(h.user);
    setPort(String(h.port ?? 22));
    if (!label) setLabel(h.alias);
    if (h.identity_file) {
      setAuthMode("key");
      setPasteKey(false);
      setKeyPath(h.identity_file);
    }
    if (h.proxy_jump) toast.warning("ProxyJump isn't supported yet", `${h.alias} uses ProxyJump ${h.proxy_jump}; connect to it directly or via a tunnel.`);
  }

  async function browseKey() {
    const selected = await open({ multiple: false, title: "Choose a private key", defaultPath: keyPath || undefined }).catch(() => null);
    if (typeof selected === "string") setKeyPath(selected);
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const r: TestResult = await api.testConnection(args);
      if (r.success) {
        setTestResult({ ok: true, text: `Login works · ${r.latency_ms} ms${r.server_version ? ` · ${r.server_version.replace(/^SSH-2\.0-/, "")}` : ""}` });
      } else {
        setTestResult({
          ok: false,
          text: r.reason === "host_key_changed"
            ? "Reachable, but the host key differs from known_hosts. Connect to review it."
            : `Server reachable (${r.latency_ms} ms). Its host key isn't trusted yet — credentials were not sent. Connect to review it.`,
        });
      }
    } catch (e) {
      setTestResult({ ok: false, text: errMsg(e) });
    } finally {
      setTesting(false);
    }
  }

  function finish(info: import("../../types").ConnectionInfo) {
    if (saveToServers) {
      saveServer({
        id: connectPrefill?.id ?? crypto.randomUUID(),
        label: info.label,
        host: info.host,
        port: info.port,
        username: info.username,
        authType: authMode,
        keyPath: authMode === "key" && !pasteKey ? keyPath.trim() : undefined,
        savedPassword: savePassword && authMode === "password" ? password : undefined,
        lastConnected: new Date().toISOString(),
      });
    }
    setConnectModal(false);
    useUiStore.getState().setActiveTab(useUiStore.getState().activeTab === "terminal" ? "terminal" : "files");
  }

  async function handleConnect() {
    if (!canSubmit || connecting) return;
    setConnecting(true);
    setError(null);
    setTestResult(null);
    try {
      const r = await connectQuick(args);
      if (r.kind === "connected") return finish(r.info);
      const info = await hostKey.prompt(r.verification, { quick: args });
      if (info) finish(info);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setConnecting(false);
    }
  }

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !(e.target as HTMLElement).matches("textarea")) {
      e.preventDefault();
      handleConnect();
    }
  };

  return (
    <>
      <Modal
        onClose={() => setConnectModal(false)}
        width={500}
        icon={<Server size={16} />}
        title={connectPrefill ? `Connect to ${connectPrefill.label}` : "New connection"}
        subtitle="SSH & SFTP. To store credentials encrypted, add them to ZVault."
        headerExtra={
          configHosts.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<FileKey size={13} />}
              onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setConfigMenu({ x: r.left, y: r.bottom + 4 });
              }}
            >
              ~/.ssh/config <ChevronDown size={12} />
            </Button>
          ) : undefined
        }
      >
        <ModalBody className="space-y-4" >
          <div onKeyDown={onEnter} className="space-y-4">
            <div className="grid grid-cols-[1fr_88px] gap-3">
              <Field label="Host">
                <Input data-autofocus value={host} onChange={(e) => setHost(e.target.value)} placeholder="example.com or 192.168.1.10" />
              </Field>
              <Field label="Port" error={!portValid ? "1–65535" : null}>
                <Input value={port} onChange={(e) => setPort(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" className="tabular" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Username">
                <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="root" />
              </Field>
              <Field label={<>Name <span className="font-normal text-slate-500">(optional)</span></>}>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={username && host ? `${username}@${host}` : "Production"} />
              </Field>
            </div>

            <div>
              <span className="field-label">Authentication</span>
              <Segmented
                className="w-full"
                value={authMode}
                onChange={setAuthMode}
                options={[
                  { value: "password", label: "Password" },
                  { value: "key", label: "SSH key" },
                  { value: "agent", label: "SSH agent" },
                ]}
              />
            </div>

            {authMode === "password" && (
              <Field label="Password" hint="Falls back to keyboard-interactive if the server requires it.">
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            )}

            {authMode === "key" && (
              <div className="space-y-3">
                {pasteKey ? (
                  <Field label="Private key">
                    <textarea
                      value={keyText}
                      onChange={(e) => setKeyText(e.target.value)}
                      placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n…"}
                      rows={4}
                      spellCheck={false}
                      className="field resize-none font-mono text-[11.5px]"
                    />
                  </Field>
                ) : (
                  <Field label="Private key file" hint="OpenSSH, PEM (RSA/ECDSA) and Ed25519 keys are supported.">
                    <div className="flex gap-2">
                      <Input mono value={keyPath} onChange={(e) => setKeyPath(e.target.value)} placeholder="~/.ssh/id_ed25519" />
                      <Button icon={<FolderOpen size={14} />} onClick={browseKey}>Browse</Button>
                    </div>
                  </Field>
                )}
                <button onClick={() => setPasteKey((v) => !v)} className="text-xs text-pylon-cyan hover:underline">
                  {pasteKey ? "Use a key file instead" : "Paste key text instead"}
                </button>
                <Field label={<>Key passphrase <span className="font-normal text-slate-500">(if the key is encrypted)</span></>}>
                  <Input type="password" value={keyPassphrase} onChange={(e) => setKeyPassphrase(e.target.value)} />
                </Field>
              </div>
            )}

            {authMode === "agent" && (
              <Callout tone="info" icon={<KeyRound size={14} />}>
                Uses the keys loaded in your running SSH agent (ssh-agent, the macOS keychain agent, or Pageant / the OpenSSH agent on Windows).
              </Callout>
            )}

            <div className="space-y-2 rounded-lg border border-void-600 bg-void-900/50 px-3 py-2.5">
              <label className="flex items-center gap-2 text-[13px] text-slate-300">
                <input type="checkbox" checked={saveToServers} onChange={(e) => setSaveToServers(e.target.checked)} />
                Save to the sidebar
              </label>
              {saveToServers && authMode === "password" && (
                <label className="flex items-start gap-2 pl-6 text-xs text-slate-400">
                  <input type="checkbox" className="mt-0.5" checked={savePassword} onChange={(e) => setSavePassword(e.target.checked)} />
                  <span>
                    Remember the password on this computer
                    <span className="block text-slate-500">Stored unencrypted in the app's local storage — use ZVault for encrypted storage.</span>
                  </span>
                </label>
              )}
            </div>

            {testResult && (
              <Callout tone={testResult.ok ? "ok" : "warn"} icon={testResult.ok ? <CheckCircle2 size={14} /> : <Info size={14} />}>
                {testResult.text}
              </Callout>
            )}
            {error && (
              <Callout tone="danger" icon={<XCircle size={14} />}>
                <span className="selectable">{error}</span>
              </Callout>
            )}
          </div>
        </ModalBody>
        <ModalFooter className="justify-between">
          <Button variant="ghost" onClick={handleTest} loading={testing} disabled={!canSubmit || connecting}>Test</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setConnectModal(false)}>Cancel</Button>
            <Button variant="primary" icon={<Plug size={14} />} onClick={handleConnect} loading={connecting} disabled={!canSubmit}>
              Connect
            </Button>
          </div>
        </ModalFooter>
      </Modal>
      <AnimatePresence>
        {configMenu && (
          <ContextMenu
            x={configMenu.x}
            y={configMenu.y}
            onClose={() => setConfigMenu(null)}
            items={configHosts.map((h) => ({
              label: `${h.alias}${h.hostname && h.hostname !== h.alias ? ` — ${h.user ? `${h.user}@` : ""}${h.hostname}` : ""}`,
              icon: <Server size={13} />,
              onClick: () => applyConfigHost(h),
            }))}
          />
        )}
      </AnimatePresence>
      {hostKey.element}
    </>
  );
}

import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Check, ChevronDown, FolderOpen, KeyRound, Lock, Pencil, Plug, Plus, ShieldCheck, Trash2, Unlock, UserRound,
} from "lucide-react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";
import { useConfirm } from "../ui/ConfirmDialog";
import { toast } from "../../stores/toastStore";
import { useHostKeyFlow } from "./HostKeyModal";
import { hasLockPassword } from "../AppLock";
import { useLockPasswordPrompt } from "../ui/LockPasswordPrompt";
import * as api from "../../lib/tauri";
import type { CredentialInput, VaultProfile } from "../../lib/tauri";
import { errMsg, formatRelative } from "../../lib/format";
import { Credential } from "../../types";
import { Button, Callout, Field, IconButton, Input, Modal, ModalBody, ModalFooter, Segmented, Spinner } from "../ui/primitives";
import { ContextMenu, ContextMenuEntry } from "../files/ContextMenu";

const PROFILE_COLORS = ["#22d3ee", "#f5a623", "#34d399", "#a78bfa", "#f87171", "#f472b6", "#60a5fa", "#a3e635"];

function strength(p: string): { score: number; label: string } {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (p.length >= 16) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  return { score: Math.min(4, s), label: ["Too short", "Weak", "Fair", "Good", "Strong"][Math.min(4, s)] };
}

function Unlock_({ exists, profileName, onDone }: { exists: boolean; profileName: string; onDone: () => void }) {
  const { unlockVault, createVault } = useConnectionStore();
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const st = strength(pass);

  async function submit() {
    if (busy || !pass) return;
    if (!exists) {
      if (pass.length < 8) return setError("Use at least 8 characters.");
      if (pass !== confirm) return setError("The passphrases don't match.");
    }
    setBusy(true);
    setError(null);
    try {
      if (exists) await unlockVault(pass);
      else await createVault(pass);
      onDone();
    } catch (e) {
      setError(errMsg(e));
      setPass("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" onKeyDown={(e) => e.key === "Enter" && submit()}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-pylon-amber/30 bg-pylon-amber/10 text-pylon-amber">
          {exists ? <Lock size={18} /> : <ShieldCheck size={18} />}
        </div>
        <div>
          <p className="text-[13px] font-medium text-slate-100">{exists ? `Unlock “${profileName}”` : `Create the “${profileName}” vault`}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
            {exists
              ? "Credentials are decrypted in memory only and locked again after inactivity."
              : "Choose a passphrase. It encrypts your credentials (AES-256-GCM, Argon2id) and cannot be recovered if you forget it."}
          </p>
        </div>
      </div>
      <Field label="Passphrase">
        <Input type="password" value={pass} onChange={(e) => { setPass(e.target.value); setError(null); }} data-autofocus />
      </Field>
      {!exists && (
        <>
          <div className="flex items-center gap-2">
            <div className="flex flex-1 gap-1">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`h-1 flex-1 rounded-full ${i < st.score ? (st.score <= 1 ? "bg-pylon-red" : st.score === 2 ? "bg-pylon-amber" : "bg-pylon-green") : "bg-void-600"}`} />
              ))}
            </div>
            <span className="w-16 text-right text-[11px] text-slate-500">{pass ? st.label : ""}</span>
          </div>
          <Field label="Repeat passphrase">
            <Input type="password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setError(null); }} />
          </Field>
        </>
      )}
      {error && <Callout tone="danger">{error}</Callout>}
      <Button variant="primary" className="w-full" onClick={submit} loading={busy} disabled={!pass} icon={exists ? <Unlock size={14} /> : <ShieldCheck size={14} />}>
        {exists ? "Unlock" : "Create vault"}
      </Button>
    </div>
  );
}

function CredentialForm({ initial, onCancel, onSaved }: { initial: Credential | null; onCancel: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(String(initial?.port ?? 22));
  const [user, setUser] = useState(initial?.username ?? "");
  const [auth, setAuth] = useState<CredentialInput["authType"]>(initial?.auth_type ?? "password");
  const [password, setPassword] = useState("");
  const [key, setKey] = useState("");
  const [keyPass, setKeyPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = !!initial;
  const sameAuth = editing && initial!.auth_type === auth;
  const portNum = Number(port);
  const valid = label.trim() && host.trim() && user.trim() && portNum >= 1 && portNum <= 65535 &&
    (auth !== "password" || password || sameAuth) && (auth !== "private_key" || key.trim() || sameAuth);

  async function browse() {
    const p = await openDialog({ multiple: false, title: "Choose a private key" }).catch(() => null);
    if (typeof p === "string") setKey(p);
  }

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const input: CredentialInput = {
      label: label.trim(), host: host.trim(), port: portNum, username: user.trim(), authType: auth,
      password: auth === "password" ? password : undefined,
      privateKey: auth === "private_key" ? key.trim() : undefined,
      keyPassphrase: auth === "private_key" ? keyPass : undefined,
    };
    try {
      if (editing) await api.vaultUpdateCredential(initial!.id, input);
      else await api.vaultAddCredential(input);
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const keep = sameAuth ? "Leave empty to keep the saved one" : undefined;
  return (
    <div className="space-y-3.5" onKeyDown={(e) => { if (e.key === "Enter" && !(e.target as HTMLElement).matches("textarea")) save(); }}>
      <p className="text-[13px] font-medium text-slate-100">{editing ? `Edit “${initial!.label}”` : "New credential"}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><Input data-autofocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Production web" /></Field>
        <Field label="Username"><Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="deploy" /></Field>
      </div>
      <div className="grid grid-cols-[1fr_88px] gap-3">
        <Field label="Host"><Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="example.com" /></Field>
        <Field label="Port"><Input value={port} onChange={(e) => setPort(e.target.value.replace(/[^\d]/g, ""))} className="tabular" /></Field>
      </div>
      <Segmented className="w-full" value={auth} onChange={setAuth} options={[
        { value: "password", label: "Password" },
        { value: "private_key", label: "SSH key" },
        { value: "agent", label: "SSH agent" },
      ]} />
      {auth === "password" && (
        <Field label="Password" hint={keep}><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={sameAuth ? "••••••••" : ""} /></Field>
      )}
      {auth === "private_key" && (
        <>
          <Field label="Key file or key text" hint={keep ?? "A path is read at connect time; pasted text is stored encrypted in the vault."}>
            <div className="flex gap-2">
              <textarea
                value={key}
                onChange={(e) => setKey(e.target.value)}
                rows={key.includes("\n") ? 4 : 1}
                spellCheck={false}
                placeholder={sameAuth ? "(unchanged)" : "~/.ssh/id_ed25519 or -----BEGIN OPENSSH PRIVATE KEY-----"}
                className="field min-h-[32px] resize-none font-mono text-[11.5px]"
              />
              <Button icon={<FolderOpen size={14} />} onClick={browse}>Browse</Button>
            </div>
          </Field>
          <Field label={<>Key passphrase <span className="font-normal text-slate-500">(optional)</span></>} hint={sameAuth && initial ? "Leave empty to keep the saved one" : undefined}>
            <Input type="password" value={keyPass} onChange={(e) => setKeyPass(e.target.value)} />
          </Field>
        </>
      )}
      {error && <Callout tone="danger">{error}</Callout>}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={busy} disabled={!valid} icon={<Check size={14} />}>{editing ? "Save changes" : "Add to vault"}</Button>
      </div>
    </div>
  );
}

function ChangePassphrase({ onDone }: { onDone: () => void }) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [rep, setRep] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (next.length < 8) return setError("Use at least 8 characters.");
    if (next !== rep) return setError("The new passphrases don't match.");
    setBusy(true);
    try {
      await api.vaultChangePassphrase(cur, next);
      toast.success("Passphrase changed");
      onDone();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3.5" onKeyDown={(e) => e.key === "Enter" && submit()}>
      <p className="text-[13px] font-medium text-slate-100">Change vault passphrase</p>
      <Field label="Current passphrase"><Input data-autofocus type="password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
      <Field label="New passphrase"><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <Field label="Repeat new passphrase"><Input type="password" value={rep} onChange={(e) => setRep(e.target.value)} /></Field>
      {error && <Callout tone="danger">{error}</Callout>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button variant="primary" onClick={submit} loading={busy} disabled={!cur || !next}>Change passphrase</Button>
      </div>
    </div>
  );
}

export function VaultModal() {
  const { setVaultModal, setActiveTab } = useUiStore();
  const { vaultUnlocked, credentials, lockVault, fetchCredentials, connectVault, credentialIdBySession, setActiveSession, refreshVaultState } = useConnectionStore();
  const confirm = useConfirm();
  const promptLockPassword = useLockPasswordPrompt();
  const hostKey = useHostKeyFlow();

  const [profiles, setProfiles] = useState<VaultProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("default");
  const [exists, setExists] = useState(true);
  const [view, setView] = useState<"list" | "form" | "passphrase">("list");
  const [editing, setEditing] = useState<Credential | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [profileMenu, setProfileMenu] = useState<{ x: number; y: number } | null>(null);
  const [newProfile, setNewProfile] = useState<string | null>(null);

  async function load() {
    const [profs, id, ex] = await Promise.all([api.vaultListProfiles(), api.vaultActiveProfileId(), api.vaultExists()]).catch(() => [[], "default", true] as const);
    setProfiles([...profs]);
    setActiveProfileId(id);
    setExists(ex);
    refreshVaultState();
  }
  useEffect(() => { load(); }, []);

  const active = profiles.find((p) => p.id === activeProfileId);
  const close = () => setVaultModal(false);

  async function selectProfile(id: string) {
    await api.vaultSelectProfile(id).catch((e) => toast.error("Couldn't switch vault", errMsg(e)));
    await lockVault();
    setView("list");
    load();
  }

  async function createProfile(name: string) {
    setNewProfile(null);
    if (!name.trim()) return;
    try {
      const p = await api.vaultCreateProfile(name.trim(), PROFILE_COLORS[profiles.length % PROFILE_COLORS.length], "Lock");
      await selectProfile(p.id);
    } catch (e) {
      toast.error("Couldn't create vault", errMsg(e));
    }
  }

  async function deleteProfile(p: VaultProfile) {
    if (hasLockPassword()) {
      const ok = await promptLockPassword({ title: "Confirm with app lock", description: `Enter the app lock password to delete “${p.name}”.` });
      if (!ok) return;
    }
    const last = profiles.length <= 1;
    const ok = await confirm({
      title: last ? `Reset “${p.name}”?` : `Delete the “${p.name}” vault?`,
      message: "All credentials in it are permanently deleted. This cannot be undone.",
      danger: true,
      confirmLabel: last ? "Reset vault" : "Delete vault",
    });
    if (!ok) return;
    try {
      if (last) await api.vaultReset();
      else await api.vaultDeleteProfile(p.id);
      await lockVault();
      toast.success(last ? "Vault reset" : "Vault deleted", p.name);
      load();
    } catch (e) {
      toast.error("Failed", errMsg(e));
    }
  }

  async function connect(cred: Credential) {
    const liveId = Object.entries(credentialIdBySession).find(([, c]) => c === cred.id)?.[0];
    if (liveId) {
      setActiveSession(liveId);
      close();
      return;
    }
    setConnecting(cred.id);
    try {
      const r = await connectVault(cred.id);
      const info = r.kind === "connected" ? r.info : await hostKey.prompt(r.verification, { credentialId: cred.id });
      if (info) {
        close();
        setActiveTab("files");
      }
    } catch (e) {
      toast.error(`Couldn't connect to ${cred.label}`, errMsg(e));
    } finally {
      setConnecting(null);
    }
  }

  async function remove(cred: Credential) {
    const ok = await confirm({ title: `Delete “${cred.label}”?`, message: "The saved credential is removed from the vault.", danger: true, confirmLabel: "Delete" });
    if (!ok) return;
    try {
      await api.vaultDeleteCredential(cred.id);
      fetchCredentials();
    } catch (e) {
      toast.error("Delete failed", errMsg(e));
    }
  }

  const profileItems: ContextMenuEntry[] = [
    ...profiles.map((p) => ({
      label: p.name,
      icon: <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />,
      shortcut: p.id === activeProfileId ? "Current" : undefined,
      onClick: () => p.id !== activeProfileId && selectProfile(p.id),
    })),
    { separator: true },
    { label: "New vault…", icon: <Plus size={13} />, onClick: () => setNewProfile("") },
    ...(active ? [{ label: profiles.length <= 1 ? `Reset “${active.name}”…` : `Delete “${active.name}”…`, icon: <Trash2 size={13} />, danger: true, onClick: () => deleteProfile(active) } as ContextMenuEntry] : []),
  ];

  return (
    <>
      <Modal
        onClose={close}
        width={540}
        icon={<KeyRound size={16} className="text-pylon-amber" />}
        title="ZVault"
        subtitle={vaultUnlocked ? `${credentials.length} saved credential${credentials.length === 1 ? "" : "s"} · unlocked` : "Encrypted credential vault"}
        headerExtra={
          <Button
            size="sm"
            variant="secondary"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setProfileMenu({ x: r.left, y: r.bottom + 4 });
            }}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: active?.color ?? "#888" }} />
            <span className="max-w-[110px] truncate">{active?.name ?? "Default"}</span>
            <ChevronDown size={12} />
          </Button>
        }
      >
        <ModalBody>
          {newProfile !== null ? (
            <div className="space-y-3" onKeyDown={(e) => { if (e.key === "Enter") createProfile(newProfile); }}>
              <p className="text-[13px] font-medium text-slate-100">New vault</p>
              <p className="text-xs text-slate-400">Separate vaults have their own passphrase — e.g. one for work and one for personal servers.</p>
              <Field label="Name"><Input data-autofocus value={newProfile} onChange={(e) => setNewProfile(e.target.value)} placeholder="Work" /></Field>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setNewProfile(null)}>Cancel</Button>
                <Button variant="primary" onClick={() => createProfile(newProfile)} disabled={!newProfile.trim()}>Create</Button>
              </div>
            </div>
          ) : !vaultUnlocked ? (
            <Unlock_ exists={exists} profileName={active?.name ?? "Default"} onDone={() => { setExists(true); fetchCredentials(); }} />
          ) : view === "form" ? (
            <CredentialForm initial={editing} onCancel={() => setView("list")} onSaved={() => { setView("list"); fetchCredentials(); }} />
          ) : view === "passphrase" ? (
            <ChangePassphrase onDone={() => setView("list")} />
          ) : credentials.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-void-600 bg-void-700 text-slate-400"><UserRound size={18} /></div>
              <p className="text-[13px] text-slate-200">No credentials yet</p>
              <p className="max-w-[320px] text-xs text-slate-500">Saved credentials connect in one click from the sidebar, and are required for sync watchers.</p>
              <Button className="mt-2" variant="primary" icon={<Plus size={14} />} onClick={() => { setEditing(null); setView("form"); }}>Add credential</Button>
            </div>
          ) : (
            <div className="-mx-2 space-y-0.5">
              {credentials.map((cred) => {
                const live = Object.values(credentialIdBySession).includes(cred.id);
                return (
                  <div
                    key={cred.id}
                    onDoubleClick={() => connect(cred)}
                    className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-void-700/70"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-void-600 bg-void-900 text-slate-400">
                      {cred.auth_type === "private_key" ? <KeyRound size={14} /> : cred.auth_type === "agent" ? <ShieldCheck size={14} /> : <Lock size={14} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-slate-100">{cred.label}</span>
                        {live && <span className="rounded bg-pylon-green/12 px-1.5 text-[10.5px] font-medium leading-4 text-pylon-green">Connected</span>}
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        {cred.username}@{cred.host}{cred.port !== 22 ? `:${cred.port}` : ""} · {cred.auth_type === "private_key" ? "SSH key" : cred.auth_type === "agent" ? "agent" : "password"} · {cred.last_used ? `used ${formatRelative(cred.last_used)}` : "never used"}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <IconButton title="Edit" onClick={() => { setEditing(cred); setView("form"); }}><Pencil size={13} /></IconButton>
                      <IconButton title="Delete" tone="danger" onClick={() => remove(cred)}><Trash2 size={13} /></IconButton>
                    </div>
                    <Button size="sm" variant={live ? "secondary" : "primary"} onClick={() => connect(cred)} disabled={!!connecting} icon={connecting === cred.id ? <Spinner /> : <Plug size={13} />}>
                      {live ? "Show" : "Connect"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </ModalBody>
        {vaultUnlocked && view === "list" && newProfile === null && (
          <ModalFooter className="justify-between">
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" icon={<Lock size={13} />} onClick={lockVault}>Lock</Button>
              <Button variant="ghost" size="sm" onClick={() => setView("passphrase")}>Change passphrase</Button>
            </div>
            {credentials.length > 0 && (
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => { setEditing(null); setView("form"); }}>Add credential</Button>
            )}
          </ModalFooter>
        )}
      </Modal>
      <AnimatePresence>{profileMenu && <ContextMenu x={profileMenu.x} y={profileMenu.y} items={profileItems} onClose={() => setProfileMenu(null)} />}</AnimatePresence>
      {hostKey.element}
    </>
  );
}

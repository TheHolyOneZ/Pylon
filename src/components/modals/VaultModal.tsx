import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle, Briefcase, Check, ChevronDown, Globe,
  Home, Key, KeyRound, Lock, Monitor, Package, Plus,
  Rocket, Shield, Target, Trash2, Unlock, X, Zap, type LucideIcon,
} from "lucide-react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useConfirm } from "../ui/ConfirmDialog";
import { toast } from "../../stores/toastStore";
import { HostKeyModal } from "./HostKeyModal";
import { hasLockPassword } from "../AppLock";
import { useLockPasswordPrompt } from "../ui/LockPasswordPrompt";
import * as api from "../../lib/tauri";
import type { VaultProfile } from "../../lib/tauri";
import { errMsg } from "../../lib/format";

const INPUT = "w-full bg-void-900 border border-void-500 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-pylon-amber/50 transition-colors";

const PRESET_COLORS = ["#00e5ff", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#ec4899", "#f97316", "#6366f1"];

const ICON_MAP: Record<string, LucideIcon> = {
  Lock, Briefcase, Home, Key, Zap, Shield, Globe, Target, KeyRound, Monitor, Rocket, Package,
};
const PRESET_ICON_NAMES = Object.keys(ICON_MAP);
const DEFAULT_ICON = "Lock";

function ProfileIcon({ name, size = 14, className }: { name: string; size?: number; className?: string }) {
  const Icon = ICON_MAP[name];
  if (Icon) return <Icon size={size} className={className} />;
  return <span style={{ fontSize: size * 0.9 }}>{name}</span>;
}

export function VaultModal() {
  const { setVaultModal } = useUiStore();
  const { vaultUnlocked, credentials, unlockVault, lockVault, addConnection, setCredentialId, fetchCredentials } = useConnectionStore();
  const confirm = useConfirm();
  const promptLockPassword = useLockPasswordPrompt();
  const hasLock = hasLockPassword();

  const [profiles, setProfiles] = useState<VaultProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("default");
  const [showProfilePicker, setShowProfilePicker] = useState(false);
  const [showCreateProfile, setShowCreateProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileColor, setNewProfileColor] = useState("#00e5ff");
  const [newProfileIcon, setNewProfileIcon] = useState(DEFAULT_ICON);

  const [passphrase, setPassphrase] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addHost, setAddHost] = useState("");
  const [addPort, setAddPort] = useState("22");
  const [addUser, setAddUser] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addAuthType, setAddAuthType] = useState<"password" | "private_key" | "agent">("password");
  const [addKey, setAddKey] = useState("");
  const [addWorking, setAddWorking] = useState(false);

  const [connecting, setConnecting] = useState<string | null>(null);
  const [pendingVaultHostKey, setPendingVaultHostKey] = useState<null | {
    credentialId: string;
    credLabel: string;
    host: string;
    port: number;
    fingerprint: string;
    keyType: string;
    changed: boolean;
  }>(null);

  useEffect(() => {
    loadProfiles();
  }, []);

  async function loadProfiles() {
    try {
      const [profs, activeId] = await Promise.all([
        api.vaultListProfiles(),
        api.vaultActiveProfileId(),
      ]);
      setProfiles(profs);
      setActiveProfileId(activeId);
    } catch {  }
  }

  async function handleSelectProfile(id: string) {
    if (vaultUnlocked) {
      await lockVault();
    }
    try {
      await api.vaultSelectProfile(id);
      setActiveProfileId(id);
      setShowProfilePicker(false);
      setPassphrase("");
      setError(null);
    } catch (e: any) {
      toast.error("Profile switch failed", errMsg(e));
    }
  }

  async function handleCreateProfile() {
    if (!newProfileName.trim()) return;
    try {
      const profile = await api.vaultCreateProfile(newProfileName.trim(), newProfileColor, newProfileIcon);
      await api.vaultSelectProfile(profile.id);
      setActiveProfileId(profile.id);
      setProfiles((prev) => [...prev, profile]);
      setShowCreateProfile(false);
      setShowProfilePicker(false);
      setNewProfileName("");
      setNewProfileColor("#00e5ff");
      setNewProfileIcon("🔒");
      toast.success("Profile created", newProfileName.trim());
    } catch (e: any) {
      toast.error("Failed to create profile", errMsg(e));
    }
  }

  async function handleDeleteProfile(profile: VaultProfile) {
    if (hasLock) {
      const ok = await promptLockPassword({
        title: "Confirm Vault Action",
        description: `Enter your app lock password to delete profile "${profile.name}"`,
      });
      if (!ok) return;
    }

    const isLastProfile = profiles.length <= 1;
    const msg = isLastProfile
      ? `Reset the "${profile.name}" vault? This permanently deletes all its credentials and the vault file. You can set a new passphrase next time you unlock.`
      : `Delete profile "${profile.name}"? All credentials in this profile will be permanently lost.`;

    const ok = await confirm({
      title: isLastProfile ? "Reset Vault" : "Delete Profile",
      message: msg,
      danger: true,
      confirmLabel: isLastProfile ? "Reset" : "Delete",
    });
    if (!ok) return;

    try {
      if (isLastProfile) {
        await api.vaultReset();
        await lockVault();
        setPassphrase("");
        toast.success("Vault reset", `${profile.name} cleared — set a new passphrase on next unlock`);
      } else {
        await api.vaultDeleteProfile(profile.id);
        const newProfiles = await api.vaultListProfiles();
        const newActiveId = await api.vaultActiveProfileId();
        setProfiles(newProfiles);
        setActiveProfileId(newActiveId);
        setShowProfilePicker(false);
        if (activeProfileId === profile.id) {
          await lockVault();
          setPassphrase("");
        }
        toast.success("Profile deleted", profile.name);
      }
    } catch (e: any) {
      toast.error("Failed", errMsg(e));
    }
  }

  async function handleUnlock() {
    setWorking(true); setError(null);
    try {
      await unlockVault(passphrase);

    } catch (e: any) {
      setError(e?.message ?? errMsg(e));
    } finally {
      setWorking(false);
    }
  }

  async function handleAddCredential() {
    if (!addLabel || !addHost || !addUser) return;
    setAddWorking(true);
    try {
      await api.vaultAddCredential({
        passphrase,
        label: addLabel,
        host: addHost,
        port: parseInt(addPort),
        username: addUser,
        password: addAuthType === "password" ? addPassword : undefined,
        privateKey: addAuthType === "private_key" ? addKey : undefined,
        authType: addAuthType,
      });
      await fetchCredentials();
      setShowAdd(false);
      setAddLabel(""); setAddHost(""); setAddUser(""); setAddPassword(""); setAddKey("");
      toast.success("Credential saved", addLabel);
    } catch (e: any) {
      toast.error("Failed to save", errMsg(e));
    } finally {
      setAddWorking(false);
    }
  }

  async function handleDelete(id: string, label: string) {
    const ok = await confirm({ message: `Delete credential "${label}"?`, danger: true, confirmLabel: "Delete" });
    if (!ok) return;
    try {
      await api.vaultDeleteCredential(passphrase, id);
      await fetchCredentials();
      toast.success("Deleted", label);
    } catch (e: any) {
      toast.error("Delete failed", errMsg(e));
    }
  }

  async function handleQuickConnect(cred: typeof credentials[0]) {
    setConnecting(cred.id);
    try {
      const result = await api.vaultConnect(cred.id);
      if (result.status === "connected" && result.info) {
        addConnection(result.info);
        setCredentialId(result.info.id, cred.id);
        setVaultModal(false);
        toast.success("Connected", cred.label);
        return;
      }
      if (result.status === "host_key_unknown" || result.status === "host_key_changed") {
        const policy = useSettingsStore.getState().hostKeyPolicy;
        if (policy === "strict") {
          toast.error("Connection rejected", `Strict policy: ${result.status === "host_key_changed" ? "host key changed" : "unknown host key"} for ${cred.host}`);
        } else if (policy === "auto-accept") {
          const info = await api.vaultAcceptHostKeyAndConnect({ credentialId: cred.id, permanent: false });
          addConnection(info);
          setCredentialId(info.id, cred.id);
          setVaultModal(false);
          toast.success("Connected", cred.label);
        } else {
          setPendingVaultHostKey({
            credentialId: cred.id,
            credLabel: cred.label,
            host: cred.host,
            port: cred.port,
            fingerprint: result.verification?.fingerprint ?? "unknown",
            keyType: result.verification?.key_type ?? "unknown",
            changed: result.status === "host_key_changed",
          });
        }
        return;
      }
      toast.error("Connection failed", result.status);
    } catch (e: any) {
      toast.error("Connection failed", e?.message ?? errMsg(e));
    } finally {
      setConnecting(null);
    }
  }

  async function handleVaultHostKeyAccept(permanent: boolean) {
    if (!pendingVaultHostKey) return;
    const { credentialId, credLabel } = pendingVaultHostKey;
    setPendingVaultHostKey(null);
    setConnecting(credentialId);
    try {
      const info = await api.vaultAcceptHostKeyAndConnect({ credentialId, permanent });
      addConnection(info);
      setCredentialId(info.id, credentialId);
      setVaultModal(false);
      toast.success("Connected", credLabel);
    } catch (e: any) {
      toast.error("Connection failed", e?.message ?? errMsg(e));
    } finally {
      setConnecting(null);
    }
  }

  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  if (pendingVaultHostKey) {
    return (
      <HostKeyModal
        host={pendingVaultHostKey.host}
        port={pendingVaultHostKey.port}
        fingerprint={pendingVaultHostKey.fingerprint}
        keyType={pendingVaultHostKey.keyType}
        changed={pendingVaultHostKey.changed}
        onAccept={handleVaultHostKeyAccept}
        onReject={() => setPendingVaultHostKey(null)}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={() => setVaultModal(false)}
    >
      <motion.div
        initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        className="w-[500px] max-h-[85vh] flex flex-col bg-void-800 border border-void-500 rounded-xl shadow-2xl overflow-hidden"
      >
        {}
        <div className="flex items-center gap-3 px-5 py-3 bg-void-900 border-b border-void-600 shrink-0">
          <Shield size={15} className="text-pylon-amber shrink-0" />
          <span className="text-sm font-semibold text-slate-200">ZVault</span>

          {}
          <button
            onClick={() => setShowProfilePicker((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-void-500 hover:border-void-400 text-xs text-slate-300 hover:bg-void-700 transition-colors"
            style={{ borderLeftColor: activeProfile?.color, borderLeftWidth: 3 }}
          >
            <ProfileIcon name={activeProfile?.icon ?? DEFAULT_ICON} size={12} className="text-slate-300" />
            <span className="max-w-[90px] truncate">{activeProfile?.name ?? "Default"}</span>
            <ChevronDown size={10} className="text-slate-500" />
          </button>

          <div className="flex-1" />
          <span className={`text-xs px-2 py-0.5 rounded-full border ${
            vaultUnlocked
              ? "border-pylon-green/30 text-pylon-green bg-pylon-green/10"
              : "border-pylon-amber/30 text-pylon-amber bg-pylon-amber/10"
          }`}>
            {vaultUnlocked ? "Unlocked" : "Locked"}
          </span>
          <button onClick={() => setVaultModal(false)} className="p-1 rounded hover:bg-void-700 text-slate-500 hover:text-slate-200 transition-colors">
            <X size={14} />
          </button>
        </div>

        {}
        <AnimatePresence>
          {showProfilePicker && (
            <motion.div
              initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-b border-void-600 bg-void-900/70"
            >
              <div className="px-4 py-2 space-y-1 max-h-52 overflow-y-auto">
                <p className="text-[10px] text-slate-600 font-semibold uppercase tracking-wider mb-2">Vault Profiles</p>

                {profiles.map((profile) => (
                  <div key={profile.id} className="flex items-center gap-2 group">
                    <button
                      onClick={() => handleSelectProfile(profile.id)}
                      className={`flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-all ${
                        profile.id === activeProfileId
                          ? "bg-void-700 text-slate-200 border border-void-500"
                          : "text-slate-400 hover:bg-void-700 hover:text-slate-200"
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: profile.color }}
                      />
                      <span className="flex items-center" style={{ color: profile.color }}>
                        <ProfileIcon name={profile.icon} size={12} />
                      </span>
                      <span className="flex-1 text-left truncate">{profile.name}</span>
                      {profile.id === activeProfileId && <Check size={10} className="text-pylon-amber" />}
                    </button>
                    <button
                      onClick={() => handleDeleteProfile(profile)}
                      title={profile.id === "default" ? "Reset this vault" : "Delete profile"}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-pylon-red/10 text-slate-600 hover:text-pylon-red transition-all"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}

                {}
                {!showCreateProfile ? (
                  <button
                    onClick={() => setShowCreateProfile(true)}
                    className="flex items-center gap-1.5 w-full px-2.5 py-1.5 rounded-lg text-xs text-slate-500 hover:text-pylon-amber hover:bg-void-700 transition-colors border border-dashed border-void-600 hover:border-pylon-amber/30 mt-1"
                  >
                    <Plus size={11} /> New profile
                  </button>
                ) : (
                  <div className="pt-1 space-y-2">
                    <input
                      value={newProfileName}
                      onChange={(e) => setNewProfileName(e.target.value)}
                      placeholder="Profile name…"
                      autoFocus
                      className="w-full bg-void-800 border border-void-500 rounded px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-pylon-amber/50"
                    />
                    {}
                    <div className="flex gap-1.5 flex-wrap">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => setNewProfileColor(c)}
                          style={{ backgroundColor: c }}
                          className={`w-5 h-5 rounded-full transition-all ${newProfileColor === c ? "ring-2 ring-white ring-offset-1 ring-offset-void-900" : "opacity-70 hover:opacity-100"}`}
                        />
                      ))}
                    </div>
                    {}
                    <div className="flex gap-1 flex-wrap">
                      {PRESET_ICON_NAMES.map((iconName) => (
                        <button
                          key={iconName}
                          onClick={() => setNewProfileIcon(iconName)}
                          className={`p-1.5 rounded transition-all ${newProfileIcon === iconName ? "bg-pylon-amber/20 ring-1 ring-pylon-amber/40 text-pylon-amber" : "hover:bg-void-700 text-slate-400"}`}
                        >
                          <ProfileIcon name={iconName} size={13} />
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setShowCreateProfile(false)} className="flex-1 py-1 rounded text-xs text-slate-500 hover:text-slate-300 border border-void-600 hover:bg-void-700 transition-colors">Cancel</button>
                      <button onClick={handleCreateProfile} disabled={!newProfileName.trim()} className="flex-1 py-1 rounded text-xs bg-pylon-amber/10 border border-pylon-amber/30 text-pylon-amber hover:bg-pylon-amber/20 transition-colors disabled:opacity-40">Create</button>
                    </div>
                  </div>
                )}

                {}
                {!hasLock && (
                  <div className="mt-2 flex items-start gap-1.5 px-2 py-1.5 rounded bg-pylon-red/5 border border-pylon-red/15">
                    <AlertTriangle size={10} className="text-pylon-red/70 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-pylon-red/70 leading-tight">
                      No app lock set — anyone on this PC can delete profiles (but cannot enter them without the passphrase).
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!vaultUnlocked ? (
            <>
              <p className="text-xs text-slate-500">
                Enter your passphrase to unlock <strong className="text-slate-300">{activeProfile?.name ?? "Default"}</strong>. Uses AES-256-GCM with Argon2id key derivation.
              </p>
              <input
                type="password" value={passphrase}
                onChange={(e) => { setPassphrase(e.target.value); setError(null); }}
                onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
                placeholder="Vault passphrase…"
                autoFocus
                className={INPUT}
              />
              {error && (
                <div className="flex items-center gap-2 px-3 py-2 bg-pylon-red/10 border border-pylon-red/20 rounded-lg">
                  <AlertTriangle size={13} className="text-pylon-red shrink-0" />
                  <p className="text-xs text-pylon-red">{error}</p>
                </div>
              )}
              <button onClick={handleUnlock} disabled={working || !passphrase}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-pylon-amber/10 border border-pylon-amber/30 text-pylon-amber text-sm font-medium hover:bg-pylon-amber/20 transition-all disabled:opacity-40">
                {working ? <span className="w-3 h-3 border border-pylon-amber border-t-transparent rounded-full animate-spin" /> : <Unlock size={14} />}
                Unlock
              </button>

              {}
              <div className="pt-1 border-t border-void-700">
                <p className="text-[10px] text-slate-600 text-center">
                  Locked out?{" "}
                  <button
                    onClick={() => setShowProfilePicker(true)}
                    className="text-pylon-amber/60 hover:text-pylon-amber underline"
                  >
                    Delete this profile
                  </button>
                  {" "}and start fresh.
                  {!hasLock && (
                    <span className="block mt-0.5 text-slate-700">
                      Set an app lock in Settings to prevent others from deleting profiles.
                    </span>
                  )}
                </p>
              </div>
            </>
          ) : (
            <>
              {}
              <div className="space-y-1.5">
                {credentials.length === 0 && !showAdd && (
                  <p className="text-xs text-slate-600 text-center py-6">No saved credentials — add one below</p>
                )}
                {credentials.map((cred) => (
                  <div key={cred.id}
                    className="flex items-center gap-3 px-3 py-2 bg-void-900 rounded-lg border border-void-600 group">
                    <KeyRound size={13} className="text-pylon-amber shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-200 truncate">{cred.label}</p>
                      <p className="text-[10px] text-slate-600">{cred.username}@{cred.host}:{cred.port} · {cred.auth_type}</p>
                    </div>
                    <button
                      onClick={() => handleQuickConnect(cred)}
                      disabled={connecting === cred.id}
                      title="Quick-connect"
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-pylon-cyan/15 text-pylon-cyan/60 hover:text-pylon-cyan transition-all"
                    >
                      {connecting === cred.id
                        ? <span className="w-3 h-3 border border-pylon-cyan border-t-transparent rounded-full animate-spin block" />
                        : <Zap size={12} />}
                    </button>
                    <button
                      onClick={() => handleDelete(cred.id, cred.label)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-pylon-red/10 text-slate-600 hover:text-pylon-red transition-all"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>

              {}
              <AnimatePresence>
                {showAdd && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-3 pt-1 border-t border-void-600">
                      <p className="text-xs font-medium text-slate-400 pt-2">New Credential</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Label</label>
                          <input value={addLabel} onChange={(e) => setAddLabel(e.target.value)} placeholder="My Server" className={INPUT} />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Username</label>
                          <input value={addUser} onChange={(e) => setAddUser(e.target.value)} placeholder="root" className={INPUT} />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Host</label>
                          <input value={addHost} onChange={(e) => setAddHost(e.target.value)} placeholder="192.168.1.1" className={INPUT} />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Port</label>
                          <input value={addPort} onChange={(e) => setAddPort(e.target.value)} className={INPUT} />
                        </div>
                      </div>
                      <div className="flex gap-1 bg-void-900 p-1 rounded-lg">
                        {(["password", "private_key", "agent"] as const).map((m) => (
                          <button key={m} onClick={() => setAddAuthType(m)}
                            className={`flex-1 py-1 rounded text-xs font-medium capitalize transition-all ${
                              addAuthType === m ? "bg-pylon-amber/10 text-pylon-amber border border-pylon-amber/20" : "text-slate-500 hover:text-slate-300"
                            }`}>
                            {m === "private_key" ? "SSH Key" : m}
                          </button>
                        ))}
                      </div>
                      {addAuthType === "password" && (
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Password</label>
                          <input type="password" value={addPassword} onChange={(e) => setAddPassword(e.target.value)} className={INPUT} />
                        </div>
                      )}
                      {addAuthType === "private_key" && (
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Private Key (PEM)</label>
                          <textarea value={addKey} onChange={(e) => setAddKey(e.target.value)}
                            placeholder="-----BEGIN RSA PRIVATE KEY-----" rows={3}
                            className={`${INPUT} font-mono text-xs resize-none`} />
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button onClick={() => setShowAdd(false)} className="flex-1 py-2 rounded-lg text-sm text-slate-500 hover:text-slate-300 border border-void-500 hover:bg-void-700 transition-colors">Cancel</button>
                        <button onClick={handleAddCredential} disabled={addWorking || !addLabel || !addHost || !addUser}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-pylon-amber/10 border border-pylon-amber/30 text-pylon-amber text-sm hover:bg-pylon-amber/20 transition-all disabled:opacity-40">
                          {addWorking ? <span className="w-3 h-3 border border-pylon-amber border-t-transparent rounded-full animate-spin" /> : <Plus size={13} />}
                          Save
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {}
              <div className="flex gap-2 pt-1 border-t border-void-700">
                {!showAdd && (
                  <button onClick={() => setShowAdd(true)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs text-slate-400 hover:text-slate-200 border border-void-600 hover:bg-void-700 transition-colors">
                    <Plus size={12} /> Add credential
                  </button>
                )}
                <button onClick={lockVault}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs text-slate-400 hover:text-slate-200 border border-void-600 hover:bg-void-700 transition-colors">
                  <Lock size={12} /> Lock
                </button>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

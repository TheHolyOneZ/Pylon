import * as api from "./tauri";
import { errMsg } from "./format";
import { joinLocal, joinRemote, normalizeLocal } from "./path";
import { useFileStore } from "../stores/fileStore";
import { useUiStore } from "../stores/uiStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useActivityStore } from "../stores/activityStore";
import { toast } from "../stores/toastStore";

export interface Item {
  path: string;
  name: string;
  is_dir: boolean;
}

async function resolveConflicts(dests: { name: string; dest: string }[], exists: (paths: string[]) => Promise<boolean[]>): Promise<Set<string> | null> {
  const fs = useFileStore.getState();
  if (dests.length === 0 || fs.overwritePolicy === "overwrite_all") return new Set();
  let flags: boolean[];
  try {
    flags = await exists(dests.map((d) => d.dest));
  } catch (e) {
    toast.error("Could not check destination", errMsg(e));
    return null;
  }
  const conflicts = dests.filter((_, i) => flags[i]);
  if (conflicts.length === 0) return new Set();
  if (fs.overwritePolicy === "skip_all") return new Set(conflicts.map((c) => c.dest));

  const { action, remember } = await useUiStore.getState().askOverwrite(conflicts.map((c) => c.name));
  if (action === "cancel") return null;
  if (remember) fs.setOverwritePolicy(action === "overwrite" ? "overwrite_all" : "skip_all");
  return action === "overwrite" ? new Set() : new Set(conflicts.map((c) => c.dest));
}

function summarise(kind: "Upload" | "Download", done: number, failed: string[], skipped: number) {
  if (failed.length) {
    toast.error(`${kind} finished with ${failed.length} error${failed.length > 1 ? "s" : ""}`, failed.slice(0, 3).join("\n"));
  } else if (done > 1 || skipped) {
    toast.success(`${kind} complete`, `${done} item${done === 1 ? "" : "s"}${skipped ? ` · ${skipped} skipped` : ""}`);
  }
}

export async function uploadItems(sessionId: string, items: Item[], remoteDir: string, opts: { strip?: boolean } = {}) {
  if (!items.length) return;
  const strip = opts.strip ?? useSettingsStore.getState().autoStripMetadata;
  const plan = items.map((i) => ({ ...i, dest: joinRemote(remoteDir, i.name) }));
  const skip = await resolveConflicts(plan.filter((p) => !p.is_dir), (paths) => api.remotePathsExist(sessionId, paths));
  if (!skip) return;

  const failed: string[] = [];
  let done = 0;
  for (const it of [...plan.filter((p) => !p.is_dir), ...plan.filter((p) => p.is_dir)]) {
    if (skip.has(it.dest)) continue;
    try {
      if (it.is_dir) {
        const r = await api.uploadDirectory(sessionId, it.path, it.dest, strip);
        if (r.failed) failed.push(`${it.name}: ${r.failed} file(s) failed — ${r.errors[0] ?? ""}`);
      } else {
        await api.uploadFile(sessionId, it.path, it.dest, strip);
      }
      done++;
    } catch (e) {
      failed.push(`${it.name}: ${errMsg(e)}`);
    }
  }
  summarise("Upload", done, failed, skip.size);
  if (failed.length) useActivityStore.getState().add({ type: "error", message: "Upload errors", detail: failed.join("\n") });
  const fs = useFileStore.getState();
  if (fs.remotePath === remoteDir) fs.refreshRemote(sessionId);
}

export async function downloadItems(sessionId: string, items: Item[], localDir: string) {
  if (!items.length) return;
  const plan = items.map((i) => ({ ...i, dest: joinLocal(localDir, i.name) }));
  const skip = await resolveConflicts(plan.filter((p) => !p.is_dir), (paths) => api.localPathsExist(paths));
  if (!skip) return;

  const failed: string[] = [];
  let done = 0;
  for (const it of [...plan.filter((p) => !p.is_dir), ...plan.filter((p) => p.is_dir)]) {
    if (skip.has(it.dest)) continue;
    try {
      if (it.is_dir) {
        const r = await api.downloadDirectory(sessionId, it.path, it.dest);
        if (r.failed) failed.push(`${it.name}: ${r.failed} file(s) failed — ${r.errors[0] ?? ""}`);
      } else {
        await api.downloadFile(sessionId, it.path, it.dest);
      }
      done++;
    } catch (e) {
      failed.push(`${it.name}: ${errMsg(e)}`);
    }
  }
  summarise("Download", done, failed, skip.size);
  if (failed.length) useActivityStore.getState().add({ type: "error", message: "Download errors", detail: failed.join("\n") });
  const fs = useFileStore.getState();
  if (normalizeLocal(fs.localPath) === normalizeLocal(localDir)) fs.refreshLocal();
}

export async function uploadDroppedPaths(sessionId: string, paths: string[], remoteDir: string) {
  const dirs = await api.localIsDir(paths).catch(() => paths.map(() => false));
  const items = paths.map((p, i) => {
    const norm = p.replace(/\\/g, "/").replace(/\/+$/, "");
    return { path: p, name: norm.split("/").pop() || norm, is_dir: dirs[i] };
  });
  await uploadItems(sessionId, items, remoteDir);
}

export async function moveItems(pane: "local" | "remote", sessionId: string | null, items: Item[], targetDir: string) {
  const movable = items.filter((i) => i.path !== targetDir && !targetDir.startsWith(i.path + "/"));
  if (!movable.length) return;
  const fs = useFileStore.getState();
  try {
    if (pane === "local") {
      await api.moveLocal(movable.map((i) => i.path), targetDir);
      fs.refreshLocal();
    } else if (sessionId) {
      const errors: string[] = [];
      for (const it of movable) {
        try {
          await api.renameRemote(sessionId, it.path, joinRemote(targetDir, it.name));
        } catch (e) {
          errors.push(`${it.name}: ${errMsg(e)}`);
        }
      }
      fs.refreshRemote(sessionId);
      if (errors.length) throw new Error(errors.join("\n"));
    }
    toast.success("Moved", `${movable.length} item${movable.length > 1 ? "s" : ""} → ${targetDir.split("/").pop() || targetDir}`);
  } catch (e) {
    toast.error("Move failed", errMsg(e));
  }
}

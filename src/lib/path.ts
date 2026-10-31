let _platform: "windows" | "macos" | "linux" | string = "linux";

export async function initPlatform() {
  try {
    const { getPlatform } = await import("./tauri");
    _platform = await getPlatform();
  } catch {
    const ua = navigator.userAgent;
    _platform = /Windows/.test(ua) ? "windows" : /Mac/.test(ua) ? "macos" : "linux";
  }
  document.documentElement.dataset.platform = _platform;
}

export const getPlatformCached = () => _platform;
export const isMac = () => _platform === "macos";
export const isWindows = () => _platform === "windows";

export const modKey = () => (isMac() ? "⌘" : "Ctrl");

export const isMod = (e: KeyboardEvent | React.KeyboardEvent) => (isMac() ? e.metaKey : e.ctrlKey);

export function normalizeSeparators(p: string): string {
  return p.replace(/\\/g, "/");
}

export function normalizeLocal(p: string): string {
  let s = normalizeSeparators(p.trim());
  if (/^[a-zA-Z]:$/.test(s)) return s + "/";
  const unc = s.startsWith("//");
  s = s.replace(/\/{2,}/g, "/");
  if (unc) s = "/" + s;
  if (s.length > 1 && s.endsWith("/") && !/^[a-zA-Z]:\/$/.test(s)) s = s.slice(0, -1);
  return s || "/";
}

export function isLocalRoot(p: string): boolean {
  const n = normalizeLocal(p);
  return n === "/" || /^[a-zA-Z]:\/$/.test(n);
}

export function joinLocal(parent: string, child: string): string {
  const base = normalizeLocal(parent);
  return base.endsWith("/") ? base + child : `${base}/${child}`;
}

export function parentLocal(p: string): string {
  const n = normalizeLocal(p);
  if (isLocalRoot(n)) return n;
  const idx = n.lastIndexOf("/");
  if (idx <= 0) return "/";
  const parent = n.slice(0, idx);
  return /^[a-zA-Z]:$/.test(parent) ? parent + "/" : parent;
}

export interface Crumb {
  label: string;
  path: string;
}

export function localCrumbs(p: string): Crumb[] {
  const n = normalizeLocal(p);
  const drive = n.match(/^([a-zA-Z]:)\//);
  if (drive) {
    const root = drive[1] + "/";
    const parts = n.slice(root.length).split("/").filter(Boolean);
    return [
      { label: drive[1], path: root },
      ...parts.map((part, i) => ({ label: part, path: root + parts.slice(0, i + 1).join("/") })),
    ];
  }
  const parts = n.split("/").filter(Boolean);
  return [{ label: "/", path: "/" }, ...parts.map((part, i) => ({ label: part, path: "/" + parts.slice(0, i + 1).join("/") }))];
}

export function joinRemote(parent: string, child: string): string {
  if (!parent || parent === "/") return `/${child.replace(/^\/+/, "")}`;
  return `${parent.replace(/\/+$/, "")}/${child.replace(/^\/+/, "")}`;
}

export function parentRemote(p: string): string {
  const s = p.replace(/\/+$/, "");
  const idx = s.lastIndexOf("/");
  return idx <= 0 ? "/" : s.slice(0, idx);
}

export function remoteCrumbs(p: string): Crumb[] {
  const parts = p.split("/").filter(Boolean);
  return [{ label: "/", path: "/" }, ...parts.map((part, i) => ({ label: part, path: "/" + parts.slice(0, i + 1).join("/") }))];
}

export function sameDir(a: string, b: string): boolean {
  return normalizeLocal(a).toLowerCase() === normalizeLocal(b).toLowerCase() || normalizeLocal(a) === normalizeLocal(b);
}

export function dirname(p: string): string {
  return p.includes("\\") || /^[a-zA-Z]:/.test(p) ? parentLocal(p) : parentRemote(p);
}

export function basename(p: string): string {
  const norm = normalizeSeparators(p);
  return norm.split("/").filter(Boolean).pop() ?? p;
}

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function joinPath(...parts: string[]): string {
  return parts.reduce((acc, p) => (acc ? joinLocal(acc, p) : p), "");
}

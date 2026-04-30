


let _sep = "/";
let _platform = "linux";

export async function initPlatform() {
  try {
    const { getPlatform } = await import("./tauri");
    _platform = await getPlatform();
    _sep = _platform === "windows" ? "\\" : "/";
  } catch {

  }
}

export function getSep() { return _sep; }
export function getPlatformCached() { return _platform; }


export function joinPath(...parts: string[]): string {
  if (_platform === "windows") {

    const joined = parts.join(_sep).replace(/[\\/]+/g, _sep);
    return joined;
  }
  return parts.join("/").replace(/\/+/g, "/") || "/";
}


export function dirname(p: string): string {
  if (_platform === "windows") {
    const norm = p.replace(/\\/g, "/");
    const last = norm.lastIndexOf("/");
    if (last <= 0) return p.split("/")[0] + "/" || p;
    return p.slice(0, last);
  }
  const last = p.lastIndexOf("/");
  if (last === 0) return "/";
  if (last < 0) return "/";
  return p.slice(0, last);
}


export function basename(p: string): string {
  const norm = p.replace(/\\/g, "/");
  return norm.split("/").filter(Boolean).pop() ?? p;
}


export function normalizeSeparators(p: string): string {
  return p.replace(/\\/g, "/");
}

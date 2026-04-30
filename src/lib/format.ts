export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

export function formatDate(isoString: string | null): string {
  if (!isoString) return "—";
  return new Date(isoString).toLocaleString();
}

export function formatUnixTime(ts: number | null): string {
  if (ts == null) return "—";
  return new Date(ts * 1000).toLocaleString();
}

export function formatPermissions(perm: number | null): string {
  if (perm == null) return "—";
  const p = perm & 0o777;
  const str = (n: number) =>
    [(n & 4) ? "r" : "-", (n & 2) ? "w" : "-", (n & 1) ? "x" : "-"].join("");
  return str((p >> 6) & 7) + str((p >> 3) & 7) + str(p & 7);
}

export function formatSpeed(bps: number): string {
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function formatETA(secs: number | null): string {
  if (secs == null || secs <= 0) return "—";
  if (secs < 60) return `${Math.ceil(secs)}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${Math.ceil(secs % 60)}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

export function formatOctal(perm: number | null): string {
  if (perm == null) return "000";
  return (perm & 0o777).toString(8).padStart(3, "0");
}

export function errMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    const msg = obj.message ?? obj.kind;
    if (typeof msg === "string") return msg;
    return JSON.stringify(e);
  }
  return String(e);
}

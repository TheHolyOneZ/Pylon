import { Archive, File, FileCode, FileImage, FileLock2, FileSpreadsheet, FileText, FileVideo, Folder, FolderSymlink, Link2, Music, Package, Terminal } from "lucide-react";

const GROUPS: [RegExp, typeof File, string][] = [
  [/^(ts|tsx|js|jsx|mjs|cjs|rs|py|go|rb|php|java|kt|swift|c|h|cpp|hpp|cs|lua|dart|vue|svelte|html?|css|scss|sql)$/, FileCode, "text-sky-300/80"],
  [/^(sh|bash|zsh|fish|ps1|bat|cmd)$/, Terminal, "text-emerald-300/80"],
  [/^(json|ya?ml|toml|ini|conf|cfg|env|xml|lock)$/, FileText, "text-amber-200/75"],
  [/^(md|mdx|txt|rst|log|pdf|docx?|odt|rtf)$/, FileText, "text-slate-400"],
  [/^(csv|tsv|xlsx?|ods)$/, FileSpreadsheet, "text-emerald-300/80"],
  [/^(png|jpe?g|gif|webp|svg|bmp|tiff?|ico|heic|heif|avif)$/, FileImage, "text-fuchsia-300/75"],
  [/^(mp4|mkv|mov|avi|webm|wmv|flv)$/, FileVideo, "text-rose-300/75"],
  [/^(mp3|flac|wav|ogg|aac|m4a|opus)$/, Music, "text-rose-300/75"],
  [/^(zip|tar|gz|tgz|bz2|xz|zst|7z|rar|iso|dmg)$/, Archive, "text-orange-300/75"],
  [/^(deb|rpm|apk|pkg|msi|exe|appimage|snap)$/, Package, "text-orange-300/75"],
  [/^(pem|key|crt|cer|pub|gpg|asc|kdbx)$/, FileLock2, "text-yellow-200/80"],
];

export function FileIcon({ name, isDir, isSymlink, size = 15 }: { name: string; isDir: boolean; isSymlink?: boolean; size?: number }) {
  if (isDir) {
    const Icon = isSymlink ? FolderSymlink : Folder;
    return <Icon size={size} className="shrink-0 fill-pylon-violet/20 text-pylon-violet" strokeWidth={1.6} />;
  }
  if (isSymlink) return <Link2 size={size} className="shrink-0 text-slate-400" strokeWidth={1.6} />;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  for (const [re, Icon, cls] of GROUPS) {
    if (re.test(ext)) return <Icon size={size} className={`shrink-0 ${cls}`} strokeWidth={1.6} />;
  }
  return <File size={size} className="shrink-0 text-slate-500" strokeWidth={1.6} />;
}

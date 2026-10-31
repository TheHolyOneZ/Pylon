import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { listen } from "@tauri-apps/api/event";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import * as api from "./tauri";
import { isMac } from "./path";
import { useSettingsStore } from "../stores/settingsStore";
import { useTerminalStore } from "../stores/terminalStore";

interface Managed {
  terminal: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
  inputChain: Promise<unknown>;
  lastSize: { cols: number; rows: number };
}

const terms = new Map<string, Managed>();
const early = new Map<string, Uint8Array[]>();
let listening = false;

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function cssVar(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `rgb(${v.split(/\s+/).join(",")})` : "#000";
}

export function terminalTheme(): ITheme {
  return {
    background: cssVar("--void-900"),
    foreground: cssVar("--ink-200"),
    cursor: cssVar("--accent"),
    cursorAccent: cssVar("--void-900"),
    selectionBackground: "rgba(120, 170, 255, 0.28)",
    black: "#1b1e25", brightBlack: "#5b6273",
    red: "#f0727b", brightRed: "#ff8f97",
    green: "#7fd88f", brightGreen: "#9be8a8",
    yellow: "#e7c263", brightYellow: "#f5d77f",
    blue: "#6aa8ff", brightBlue: "#8dbdff",
    magenta: "#c297ff", brightMagenta: "#d4b3ff",
    cyan: "#5fd3e6", brightCyan: "#85e2f0",
    white: "#c9ced8", brightWhite: "#f4f6fa",
  };
}

export function ensureTerminalListeners() {
  if (listening) return;
  listening = true;
  listen<{ terminal_id: string; data: string }>("terminal://output", (e) => {
    const bytes = decode(e.payload.data);
    const t = terms.get(e.payload.terminal_id);
    if (t) t.terminal.write(bytes);
    else early.set(e.payload.terminal_id, [...(early.get(e.payload.terminal_id) ?? []), bytes]);
  });
  listen<{ terminal_id: string; exit_status: number | null }>("terminal://died", (e) => {
    useTerminalStore.getState().markTerminalDead(e.payload.terminal_id);
    const t = terms.get(e.payload.terminal_id);
    t?.terminal.write("\r\n\x1b[2m[session ended]\x1b[0m\r\n");
  });
}

function send(m: Managed, terminalId: string, data: string) {
  m.inputChain = m.inputChain.then(() => api.terminalInput(terminalId, data)).catch(() => {});
}

export async function copySelection(terminalId: string): Promise<boolean> {
  const sel = terms.get(terminalId)?.terminal.getSelection();
  if (!sel) return false;
  await writeText(sel).catch(() => navigator.clipboard.writeText(sel));
  return true;
}

export async function pasteInto(terminalId: string) {
  const m = terms.get(terminalId);
  if (!m) return;
  const text = await readText().catch(() => navigator.clipboard.readText().catch(() => ""));
  if (text) m.terminal.paste(text);
  m.terminal.focus();
}

function create(terminalId: string): Managed {
  const s = useSettingsStore.getState();
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.inset = "0";
  const terminal = new Terminal({
    theme: terminalTheme(),
    fontFamily: s.termFontFamily,
    fontSize: s.termFontSize,
    lineHeight: 1.25,
    cursorBlink: true,
    cursorStyle: "bar",
    scrollback: s.termScrollback,
    allowProposedApi: true,
    macOptionIsMeta: true,
    rightClickSelectsWord: false,
    drawBoldTextInBrightColors: false,
    minimumContrastRatio: 4.5,
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.loadAddon(new WebLinksAddon((_e, uri) => { openUrl(uri).catch(() => {}); }));
  terminal.open(host);

  const m: Managed = { terminal, fit, host, inputChain: Promise.resolve(), lastSize: { cols: 0, rows: 0 } };

  terminal.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;
    const mac = isMac();
    const key = e.key.toLowerCase();
    if ((mac && e.metaKey && !e.shiftKey && key === "c") || (!mac && e.ctrlKey && e.shiftKey && key === "c")) {
      e.preventDefault();
      copySelection(terminalId);
      return false;
    }
    if ((mac && e.metaKey && key === "v") || (!mac && e.ctrlKey && e.shiftKey && key === "v") || (e.shiftKey && e.key === "Insert")) {
      e.preventDefault();
      pasteInto(terminalId);
      return false;
    }
    if ((!mac && e.ctrlKey && e.shiftKey) || (mac && e.metaKey)) return false;
    return true;
  });

  terminal.onData((data) => send(m, terminalId, data));
  terminal.onBinary((data) => send(m, terminalId, data));
  terminal.onResize(({ cols, rows }) => {
    if (cols === m.lastSize.cols && rows === m.lastSize.rows) return;
    m.lastSize = { cols, rows };
    api.resizeTerminal(terminalId, cols, rows).catch(() => {});
  });

  terms.set(terminalId, m);
  for (const chunk of early.get(terminalId) ?? []) terminal.write(chunk);
  early.delete(terminalId);
  return m;
}

export function attachTerminal(terminalId: string, container: HTMLElement): () => void {
  const m = terms.get(terminalId) ?? create(terminalId);
  if (m.host.parentElement !== container) container.appendChild(m.host);
  const refit = () => {
    if (!container.isConnected || container.clientWidth === 0 || container.clientHeight === 0) return;
    try {
      m.fit.fit();
    } catch {
    }
  };
  let raf = requestAnimationFrame(refit);
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(refit);
  });
  ro.observe(container);
  return () => {
    ro.disconnect();
    cancelAnimationFrame(raf);
  };
}

export function focusTerminal(terminalId: string) {
  terms.get(terminalId)?.terminal.focus();
}

export function clearTerminal(terminalId: string) {
  terms.get(terminalId)?.terminal.clear();
}

export function sendToTerminal(terminalId: string, data: string) {
  const m = terms.get(terminalId);
  if (m) send(m, terminalId, data);
  else api.terminalInput(terminalId, data).catch(() => {});
}

export function disposeTerminal(terminalId: string) {
  const m = terms.get(terminalId);
  if (!m) return;
  m.terminal.dispose();
  m.host.remove();
  terms.delete(terminalId);
  early.delete(terminalId);
}

export function applyTerminalSettings() {
  const s = useSettingsStore.getState();
  const theme = terminalTheme();
  terms.forEach((m) => {
    m.terminal.options.fontSize = s.termFontSize;
    m.terminal.options.fontFamily = s.termFontFamily;
    m.terminal.options.scrollback = s.termScrollback;
    m.terminal.options.theme = theme;
    try {
      m.fit.fit();
    } catch {
    }
  });
}

export const initialSize = { cols: 120, rows: 32 };

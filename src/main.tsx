import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import App from "./App";
import "./styles/globals.css";
import { initPlatform } from "./lib/path";
import { getHomeDir } from "./lib/tauri";
import { useFileStore } from "./stores/fileStore";
import { useSettingsStore } from "./stores/settingsStore";

document.addEventListener(
  "contextmenu",
  (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    e.preventDefault();
  },
  true,
);

async function bootstrap() {
  await initPlatform();
  document.documentElement.setAttribute("data-theme", useSettingsStore.getState().theme);

  const fs = useFileStore.getState();
  const custom = useSettingsStore.getState().defaultLocalPath.trim();
  let start = custom || fs.localPath;
  if (!start || start === "/") {
    start = await getHomeDir().catch(() => "/");
  }
  fs.navigateLocal(start).then(() => {
    if (useFileStore.getState().localError) {
      getHomeDir().then((home) => useFileStore.getState().navigateLocal(home)).catch(() => {});
    }
  });

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

bootstrap();

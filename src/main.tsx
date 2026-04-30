


import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import { initPlatform } from "./lib/path";
import { getHomeDir } from "./lib/tauri";
import { useFileStore } from "./stores/fileStore";
import { useSettingsStore } from "./stores/settingsStore";

document.addEventListener("contextmenu", (e) => e.preventDefault(), true);

async function bootstrap() {
  await initPlatform();
  try {
    const customPath = useSettingsStore.getState().defaultLocalPath;
    if (customPath && customPath.trim()) {
      useFileStore.getState().navigateLocal(customPath.trim());
    } else {
      const home = await getHomeDir();
      if (home && useFileStore.getState().localPath === "/") {
        useFileStore.getState().navigateLocal(home);
      }
    }
  } catch {

  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

bootstrap();

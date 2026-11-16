import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { loadSettings, restoreSettings, settingsMissing } from "./lib/settings";
import { applyTheme, watchSystemTheme } from "./lib/theme";
import "./styles/index.css";

function start() {
  void applyTheme(loadSettings().theme).catch(() => {});
  watchSystemTheme();

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

if (settingsMissing()) void restoreSettings().finally(start);
else start();

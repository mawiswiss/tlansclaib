import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { loadSettings } from "./lib/settings";
import { applyTheme } from "./lib/theme";
import "./styles.css";

void applyTheme(loadSettings().theme).catch(() => {});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

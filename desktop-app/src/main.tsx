import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

async function start() {
  // In a plain browser during development there is no preload API; use the in-memory stand-in for UI work.
  if (import.meta.env.DEV && !window.aniDesktop) (await import("./devApi")).installDevApi();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void start();

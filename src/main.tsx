import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import TrayPanel from "./TrayPanel";
import "./style.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {new URLSearchParams(location.search).get("panel") === "tray" ? (
      <TrayPanel />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);

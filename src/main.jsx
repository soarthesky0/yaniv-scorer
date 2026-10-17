import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { LiveViewer } from "./LiveUI.jsx";
import { isValidCode, normalizeCode } from "./live.js";
import "./index.css";

// ?live=コード で開かれたら閲覧専用の画面を出す（自分の記録には触れない）
const liveCode = normalizeCode(new URLSearchParams(window.location.search).get("live") || "");

ReactDOM.createRoot(document.getElementById("root")).render(
  isValidCode(liveCode) ? <LiveViewer code={liveCode} /> : <App />
);

import React from "react";
import ReactDOM from "react-dom/client";
import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";
import PlayerApp from "./PlayerApp";
import "./player.css";

ReactDOM.createRoot(document.getElementById("player-root")!).render(
  <React.StrictMode><PlayerApp /></React.StrictMode>
);

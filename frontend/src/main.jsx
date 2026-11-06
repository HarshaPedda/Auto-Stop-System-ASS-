import React from "react";
import ReactDOM from "react-dom/client";
import AdvancedCutOptimizer from "../app.jsx";
import LoginGate from "./Login.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LoginGate>
      <AdvancedCutOptimizer />
    </LoginGate>
  </React.StrictMode>
);

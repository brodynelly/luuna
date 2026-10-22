import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { applyPlatform } from "./design/platform";
import type { PlatformSource } from "./design/platform";

applyPlatform(document.documentElement, navigator as PlatformSource);
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

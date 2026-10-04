import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installStaleDeployRecovery } from "./lib/staleDeploy";

installStaleDeployRecovery();

createRoot(document.getElementById("root")!).render(<App />);

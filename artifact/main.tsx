// Artifact entry: the same React dashboard as the local app, wired to the artifact's own data client.
import { createRoot } from "react-dom/client";
import Dashboard from "../app/Dashboard";
import { setClient } from "../app/components/client";
import { artifactClient } from "./client";

setClient(artifactClient);
const el = document.getElementById("root");
if (el) createRoot(el).render(<Dashboard />);

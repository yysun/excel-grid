// Dev-server config for the demo app. Serves demo/ as root and imports the
// library straight from ../src so changes hot-reload without a build step.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";

const demoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: demoRoot,
  plugins: [react()],
  // Prefer PORT from the environment (assigned by tooling); 5199 otherwise.
  server: { port: Number(process.env.PORT) || 5199 },
});

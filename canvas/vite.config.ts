import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds straight into the static site served by Vercel (outputDirectory: docs).
export default defineConfig({
  plugins: [react()],
  base: "/canvas/",
  build: {
    outDir: "../docs/canvas",
    emptyOutDir: true,
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// pnpm dev: the UI on :5173, API calls proxied to the Python server on :8000.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "../public", emptyOutDir: true },  // public/ is what Vercel serves from its CDN
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
});

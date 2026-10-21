import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// pnpm dev: the UI on :5173, API calls proxied to the Python server on :8000.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "../web/static", emptyOutDir: true },  // served by the FastAPI app, here and on Vercel
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
});

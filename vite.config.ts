import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Em modo navegador, o frontend fala com o servidor `freebi-web` (porta 7878).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, proxy: { "/api": "http://127.0.0.1:7878" } },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
});

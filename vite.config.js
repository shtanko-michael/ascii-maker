import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// dev: web on :5173, api on :8787 (proxied)
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8787",
      "/media": "http://localhost:8787",
    },
  },
});

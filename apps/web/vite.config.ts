import { defineConfig } from "vite";

// Vite config for AI CRM dashboard.
// Dashboard is a pure browser app; no SSR, no Node shims needed.
export default defineConfig({
  server: {
    port: 5173,
    host: "0.0.0.0",
    // Proxy /ready to the backend so the dashboard can poll without CORS friction in dev.
    proxy: {
      "/api/ready": "http://localhost:8280",
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
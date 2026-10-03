/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.TWIN_UI_BASE_PATH || "/",
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": process.env.TWIN_DEV_API_URL || "http://127.0.0.1:8010",
      "/docs": process.env.TWIN_DEV_API_URL || "http://127.0.0.1:8010",
      "/openapi.json": process.env.TWIN_DEV_API_URL || "http://127.0.0.1:8010",
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/setupTests.ts"],
  },
});

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { strictPort: true, proxy: { "/api": "http://127.0.0.1:8000" } },
  resolve: { preserveSymlinks: true },
  build: { chunkSizeWarningLimit: 1300, rollupOptions: { output: { manualChunks: { charts: ['echarts'], react: ['react', 'react-dom'] } } } },
  test: { environment: "jsdom" },
});

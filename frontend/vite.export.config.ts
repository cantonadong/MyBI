import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Single-file runtime for "发布为页面": one IIFE script + one stylesheet, inlined into the exported HTML.
// Built after the main app into dist/export (served at /export/*).
export default defineConfig({
  plugins: [react()],
  resolve: { preserveSymlinks: true },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "dist/export",
    emptyOutDir: true,
    copyPublicDir: false,
    chunkSizeWarningLimit: 3000,
    cssCodeSplit: false,
    lib: { entry: "src/main.tsx", formats: ["iife"], name: "MyBIExport", fileName: () => "runtime.js" },
    rollupOptions: { output: { inlineDynamicImports: true, assetFileNames: (asset) => asset.name?.endsWith(".css") ? "runtime.css" : "[name][extname]" } },
  },
});

import { defineConfig } from "vite";

// IIFE embeddable widget — single-file bundle, no chunk splitting.
export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["iife"],
      name: "CrmWidget",
      fileName: () => "widget.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    target: "es2022",
    sourcemap: true,
  },
});

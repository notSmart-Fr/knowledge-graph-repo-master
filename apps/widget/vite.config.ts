import { defineConfig } from "vite";

// IIFE embeddable widget — single-file bundle; livekit-client loaded on demand via CDN.
export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["iife"],
      name: "CrmWidget",
      fileName: () => "widget.js",
    },
    rollupOptions: {
      external: ["livekit-client"],
      output: {
        inlineDynamicImports: true,
        globals: {
          "livekit-client": "LivekitClient",
        },
      },
    },
    target: "es2022",
    sourcemap: true,
  },
});

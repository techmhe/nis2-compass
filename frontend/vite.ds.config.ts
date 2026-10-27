import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Library build of the component set in src/design-system for Claude Design (design-sync): `npm run build:ds`.
// React stays external (the design runtime provides it); everything else is bundled.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  build: {
    outDir: "ds-dist",
    emptyOutDir: true,
    copyPublicDir: false,
    cssCodeSplit: false,
    lib: { entry: path.resolve(import.meta.dirname, "src/design-system/index.ts"), formats: ["es"], fileName: () => "index.js", cssFileName: "style" },
    rollupOptions: { external: ["react", "react-dom", "react/jsx-runtime", "react-dom/client"] },
  },
})

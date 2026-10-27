import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    port: 5173,
    proxy: { "/api": { target: process.env.NIS2_API_TARGET ?? "http://127.0.0.1:8000", changeOrigin: false } },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined
          if (/recharts|d3-|victory/.test(id)) return "charts"
          if (/react-markdown|remark|micromark|mdast|unified|hast/.test(id)) return "markdown"
          if (/[\\/](react|react-dom|react-router|scheduler)[\\/]/.test(id)) return "react"
          return undefined
        },
      },
    },
  },
})

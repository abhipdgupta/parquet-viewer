import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "path"
// https://vite.dev/config/
export default defineConfig({
  worker: {
    format: "es",
  },
  server: {
    port: 5173,
    host: true,
  },
  plugins: [react(), tailwindcss()],
  define: {
    global: "window",
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    cssCodeSplit: true,
    sourcemap: false,
    minify: "esbuild",
    cssMinify: "esbuild",
    outDir: "build",
  },
  resolve: {
    alias: {
      "@": path.resolve("./", __dirname, "./src"),
    },
  },
})

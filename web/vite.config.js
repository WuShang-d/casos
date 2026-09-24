import path from "path";
import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Where the dev server forwards backend traffic. It is configurable so the
// end-to-end suite can point a dev server at the throwaway backend it starts,
// rather than at whatever is already on the default port.
const backendTarget = process.env.BACKEND_URL || "http://127.0.0.1:20080";

// The dev server stands in for the Go backend: every path the backend owns is
// proxied to it, so the frontend runs against real APIs without CORS or a
// separate ServerUrl. Anything else falls through to Vite and the SPA.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {"@": path.resolve(__dirname, "./src")},
  },
  server: {
    // Bound explicitly to IPv4 loopback: Vite's default "localhost" resolves to
    // ::1 on Windows, and the Playwright config (like CI) probes
    // http://127.0.0.1:<port>, which would then never answer.
    host: "127.0.0.1",
    // PORT lets the Playwright config pick the dev port; strictPort makes a
    // clash fail loudly instead of silently binding elsewhere, which would
    // leave the test runner waiting on a URL nothing is serving.
    port: Number(process.env.PORT) || 8002,
    strictPort: true,
    proxy: {
      "/api": {target: backendTarget, changeOrigin: true, ws: true},
      "/k8s": {target: backendTarget, changeOrigin: true, ws: true},
      "/.well-known": {target: backendTarget, changeOrigin: true},
      "/mcp": {target: backendTarget, changeOrigin: true},
      "/v1": {target: backendTarget, changeOrigin: true},
    },
  },
  build: {
    outDir: "build",
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // recharts and xterm are only needed by a handful of routes; splitting
        // them keeps the initial bundle from carrying the whole charting stack.
        manualChunks: {
          recharts: ["recharts"],
          xterm: ["xterm", "xterm-addon-fit"],
          vendor: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
});

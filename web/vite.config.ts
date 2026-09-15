import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// In development the Go server runs on :8080 and Vite on :5173; proxying keeps
// the session cookie same-origin so login works exactly as it does in production.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // A reader has no unsaved state, so taking the new version on the next
      // navigation is right — no "reload?" prompt to dismiss.
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png", "icon.svg"],

      manifest: {
        name: "Readermost",
        short_name: "Readermost",
        description: "A shared feed reader for your Mattermost crowd.",
        start_url: "/unread",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#1a5fb4",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },

      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "index.html",
        // Without this the service worker answers API and OAuth requests with
        // the app shell, and login fails in a way that looks like a server bug.
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
        // Deliberately no runtime caching of /api: those responses are
        // per-user and authenticated. Offline data comes from the persisted
        // query cache instead, which clears in one call on logout.
        cleanupOutdatedCaches: true,
      },

      // The service worker is verified against a production build, not the dev
      // server, where it only gets in the way of hot reload.
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: false },
      "/auth": { target: "http://localhost:8080", changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

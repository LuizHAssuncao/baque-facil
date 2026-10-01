import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import AstroPWA from "@vite-pwa/astro";
import { offlineManifest } from "./scripts/offline-manifest.mjs";

export default defineConfig({
  integrations: [
    react(),
    AstroPWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: false,
      registerType: "prompt",
      manifest: false,
      injectManifest: {
        globPatterns: ["**/*.{html,js,css,json,webmanifest,ico,png,svg,wav,wasm,woff,woff2}"],
        globIgnores: ["**/sw.js", "**/offline-build.json"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        manifestTransforms: [offlineManifest()],
      },
      devOptions: { enabled: false },
    }),
  ],
  vite: {
    optimizeDeps: {
      include: ["tone"],
    },
  },
});

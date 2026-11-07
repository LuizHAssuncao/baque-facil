import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import AstroPWA from "@vite-pwa/astro";
import { execFileSync } from "node:child_process";
import { offlineManifest } from "./scripts/offline-manifest.mjs";
import { remarkRhythmTranscription } from "./src/lib/remarkRhythmTranscription";

function getBuildCommit() {
  const commit = process.env.CF_PAGES_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA;
  if (commit) return commit.trim();
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: new URL(".", import.meta.url),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export default defineConfig({
  markdown: {
    remarkPlugins: [remarkRhythmTranscription],
  },
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
        globPatterns: ["**/*.{html,js,css,json,webmanifest,ico,png,svg,webp,wav,wasm,woff,woff2}"],
        globIgnores: ["**/sw.js", "**/offline-build.json"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        manifestTransforms: [offlineManifest()],
      },
      devOptions: { enabled: false },
    }),
  ],
  vite: {
    define: {
      "import.meta.env.PUBLIC_APP_COMMIT": JSON.stringify(getBuildCommit()),
    },
    optimizeDeps: {
      include: ["tone"],
    },
  },
});

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const extensions = new Set([
  ".html", ".js", ".css", ".json", ".webmanifest", ".ico", ".png", ".svg",
  ".wav", ".wasm", ".woff", ".woff2",
]);

export async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return groups.flat().sort();
}

export function offlineUrl(file) {
  const path = `/${file.replaceAll("\\", "/")}`;
  return path.endsWith("/index.html") ? path.slice(0, -10) : path;
}

/** Runs after Astro has emitted HTML, JSON, and every lazy client bundle. */
export function offlineManifest(directory = resolve("dist")) {
  return async (entries) => {
    const expected = (await filesUnder(directory))
      .map((path) => path.slice(directory.length + 1).replaceAll("\\", "/"))
      .filter((path) => path !== "sw.js" && path !== "offline-build.json" && extensions.has(extname(path)));
    const included = new Set(entries.map((entry) => entry.url.replace(/^\//, "")));
    const omitted = expected.filter((file) => !included.has(file));
    if (omitted.length) throw new Error(`Offline build omitted required files: ${omitted.join(", ")}`);
    for (const required of ["index.html", "offline/index.html", "radio/index.html", "quiz/index.html", "quiz/rhythms.json", "compose/index.html", "manifest.webmanifest"]) {
      if (!included.has(required)) throw new Error(`Offline build is missing ${required}`);
    }

    const inventory = await Promise.all(entries.map(async (entry) => {
      const file = entry.url.replace(/^\//, "");
      const bytes = await readFile(join(directory, file));
      return {
        file,
        bytes: bytes.length,
        entry: {
          url: offlineUrl(file),
          revision: entry.revision ?? null,
          integrity: `sha256-${createHash("sha256").update(bytes).digest("base64")}`,
        },
      };
    }));
    inventory.sort((a, b) => a.entry.url.localeCompare(b.entry.url, "en"));
    const manifest = inventory.map(({ entry }) => entry);
    // Workbox reorders object keys when injecting, so hash ordered tuples.
    const fingerprint = JSON.stringify(manifest.map(({ url, revision, integrity }) => [url, revision, integrity]).sort());
    const release = createHash("sha256").update(fingerprint).digest("hex").slice(0, 16);
    const totalBytes = inventory.reduce((total, item) => total + item.bytes, 0);
    await writeFile(join(directory, "offline-build.json"), `${JSON.stringify({
      release,
      totalBytes,
      count: manifest.length,
      files: inventory.map(({ entry, ...item }) => ({ ...item, ...entry })),
    }, null, 2)}\n`);
    console.info(`[offline] ${manifest.length} files, ${(totalBytes / 1_000_000).toFixed(2)} MB, release ${release}`);
    return { manifest: inventory.map(({ entry, bytes }) => ({ ...entry, size: bytes })), warnings: [] };
  };
}

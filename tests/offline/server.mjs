import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

// Test-only origin: switch complete production builds without changing browser storage.
const origin = "http://127.0.0.1:4335";
let directory = resolve("dist");
let blocked = "";
let corrupt = "";
let hold = "";
const held = [];
const counts = {};
// Reproduce Pages' post-build injection: native SRI cannot validate these HTML
// bytes until the offline worker removes this exact hosting addition.
const analytics = `<!-- Cloudflare Pages Analytics --><script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "offline-test"}'></script><!-- Cloudflare Pages Analytics -->`;
const mime = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".css": "text/css", ".wav": "audio/wav", ".wasm": "application/wasm",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

createServer(async (request, response) => {
  const url = new URL(request.url, origin);
  if (url.pathname === "/__offline_test__") {
    if (request.method === "POST") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const config = JSON.parse(body);
      if (config.directory) directory = resolve(config.directory);
      if ("blocked" in config) blocked = config.blocked;
      if ("corrupt" in config) corrupt = config.corrupt;
      if ("hold" in config) {
        hold = config.hold;
        if (!hold) held.splice(0).forEach((release) => release());
      }
      if (config.reset) for (const key of Object.keys(counts)) delete counts[key];
    }
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ counts }));
    return;
  }
  counts[url.pathname] = (counts[url.pathname] ?? 0) + 1;
  if (hold && url.pathname.includes(hold)) await new Promise((release) => held.push(release));
  if (blocked && url.pathname.includes(blocked)) {
    response.writeHead(503); response.end("Intentionally unavailable"); return;
  }
  let path = resolve(directory, `.${decodeURIComponent(url.pathname)}`);
  if (path !== directory && !path.startsWith(`${directory}${sep}`)) {
    response.writeHead(403); response.end(); return;
  }
  try {
    if ((await stat(path)).isDirectory()) path = resolve(path, "index.html");
    let original = await readFile(path);
    if (corrupt && url.pathname.includes(corrupt)) {
      original = Buffer.from(extname(path) === ".html"
        ? original.toString("utf8").replace("</title>", " (different deployment)</title>")
        : "wrong deployment bytes");
    }
    const bytes = extname(path) === ".html"
      ? Buffer.from(original.toString("utf8").replace("</body>", `${analytics}</body>`))
      : original;
    response.writeHead(200, {
      "Content-Type": mime[extname(path)] ?? "application/octet-stream",
      "Content-Length": bytes.length,
      "Cache-Control": "no-store",
    });
    response.end(bytes);
  } catch {
    response.writeHead(404); response.end("Not found");
  }
}).listen(4335, "127.0.0.1");

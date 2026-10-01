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
  if (corrupt && url.pathname.includes(corrupt)) {
    response.writeHead(200, { "Content-Type": "application/javascript" }); response.end("wrong deployment bytes"); return;
  }
  let path = resolve(directory, `.${decodeURIComponent(url.pathname)}`);
  if (path !== directory && !path.startsWith(`${directory}${sep}`)) {
    response.writeHead(403); response.end(); return;
  }
  try {
    if ((await stat(path)).isDirectory()) path = resolve(path, "index.html");
    const bytes = await readFile(path);
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

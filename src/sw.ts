/// <reference lib="webworker" />
import { PrecacheController } from "workbox-precaching";
import { createPartialResponse } from "workbox-range-requests";
import { OFFLINE_CACHE_PREFIX, OFFLINE_MESSAGE, type OfflineStatus } from "./lib/offline/protocol";
import { verifyOfflineHtml } from "./lib/offline/html";

declare const self: ServiceWorkerGlobalScope;

type Entry = { url: string; revision: string | null; integrity: string };
const entries = self.__WB_MANIFEST as Entry[];
const byPath = new Map(entries.map((entry) => [entry.url, entry]));
const cacheName = `${OFFLINE_CACHE_PREFIX}precache-v1`;
const precache = new PrecacheController({
  cacheName,
  fallbackToNetwork: false,
  plugins: [{
    requestWillFetch: async ({ request }) => downloadRequest(request),
    fetchDidSucceed: async ({ request, response }) => verifyDownload(response, entryFor(new URL(request.url))),
  }],
});
precache.addToCacheList(entries);
const fingerprint = JSON.stringify(entries.map(({ url, revision, integrity }) => [url, revision, integrity]).sort());
const release = crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprint))
  .then((bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16));

// Normal worker waiting/activation protects all open players and compositions.
// Only the explicit, single-window recovery action below can skip the wait.
self.addEventListener("install", (event) => {
  event.waitUntil(precache.install(event));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(precache.activate(event));
});

function entryFor(url: URL): Entry | undefined {
  // These static routes/assets have no query-dependent representations.
  const path = url.pathname.replace(/\/index\.html$/, "/");
  return byPath.get(path) ?? byPath.get(`${path}/`);
}

function downloadRequest(request: Request): Request {
  const entry = entryFor(new URL(request.url));
  // HTML is verified after removing the host's known analytics addition. Assets
  // still use native SRI. Reload also bypasses HTTP caches during manual reset.
  return new Request(request, { cache: "reload", integrity: entry?.url.endsWith("/") ? "" : request.integrity });
}

function verifyDownload(response: Response, entry?: Entry): Promise<Response> {
  return entry?.url.endsWith("/") ? verifyOfflineHtml(response, entry.integrity) : Promise.resolve(response);
}

async function status(): Promise<OfflineStatus> {
  const cache = await caches.open(cacheName);
  const present = await Promise.all(entries.map((entry) => cache.match(precache.getCacheKeyForURL(entry.url)!)));
  const missing = present.filter((response) => !response).length;
  return { type: OFFLINE_MESSAGE, release: await release, ready: missing === 0, count: entries.length, missing };
}

async function notifyMissing() {
  const clients = await self.clients.matchAll({ type: "window" });
  for (const client of clients) client.postMessage({ type: OFFLINE_MESSAGE, missing: true });
}

async function restore(entry: Entry): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const request = downloadRequest(new Request(entry.url, {
      credentials: "same-origin",
      integrity: entry.integrity,
      signal: controller.signal,
    }));
    const response = await verifyDownload(await fetch(request), entry);
    if (response.status !== 200) throw new Error("Offline resource unavailable");
    const cache = await caches.open(cacheName);
    await cache.put(precache.getCacheKeyForURL(entry.url)!, response.clone());
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

let repairTask: Promise<void> | undefined;
function repair() {
  if (!repairTask) {
    repairTask = (async () => {
      // Serial repair bounds memory and preserves every still-valid cached entry.
      for (const entry of entries) {
        if (!await precache.matchPrecache(entry.url)) await restore(entry);
      }
    })().finally(() => { repairTask = undefined; });
  }
  return repairTask;
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== OFFLINE_MESSAGE || !event.ports[0]) return;
  const port = event.ports[0];
  event.waitUntil((async () => {
    try {
      if (event.data.action === "repair") await repair();
      const result = await status();
      if (event.data.action === "refresh-check" || event.data.action === "activate-refresh") {
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        result.windows = windows.length;
        if (event.data.action === "activate-refresh") {
          if (!result.ready || windows.length !== 1 || !event.source || !("id" in event.source) || windows[0].id !== event.source.id) throw new Error("Offline refresh unavailable");
          await self.skipWaiting();
        }
      }
      port.postMessage(result);
    } catch {
      port.postMessage({ type: OFFLINE_MESSAGE, error: true });
    }
  })());
});

async function fallback() {
  return await precache.matchPrecache("/offline/") ?? new Response(
    '<!doctype html><html lang="en-CA"><meta name="viewport" content="width=device-width"><title>Offline | Baque Fácil</title><h1>You’re offline</h1><p>Connect to download Baque Fácil for offline use.</p><a href="/">All rhythms</a><section lang="pt-BR"><h2>Você está offline</h2><p>Conecte-se para baixar o Baque Fácil e usá-lo offline.</p><a href="/">Todos os ritmos</a></section></html>',
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function sampleRangeResponse(request: Request, response: Response) {
  const blob = await response.blob();
  const parts = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range")!.trim().toLowerCase());
  const first = parts?.[1] ? Number(parts[1]) : undefined;
  const last = parts?.[2] ? Number(parts[2]) : undefined;
  // Workbox does not reject an open-ended range starting past EOF, and does not
  // clamp oversized end/suffix ranges. Normalize those before asking it to slice.
  if (!parts || (first === undefined && last === undefined) || !blob.size ||
    (first !== undefined && (!Number.isSafeInteger(first) || first >= blob.size)) ||
    (last !== undefined && (!Number.isSafeInteger(last) || (first === undefined ? last === 0 : last < first)))) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${blob.size}`, "Accept-Ranges": "bytes" } });
  }
  const start = first ?? Math.max(0, blob.size - last!);
  const end = first === undefined ? blob.size - 1 : Math.min(last ?? blob.size - 1, blob.size - 1);
  const headers = new Headers(request.headers);
  headers.set("range", `bytes=${start}-${end}`);
  // This request only carries range metadata to the helper. Media requests use
  // no-cors, whose header guard would otherwise strip the normalized Range.
  const rangeRequest = new Request(request.url, { headers, mode: "same-origin" });
  const partial = await createPartialResponse(rangeRequest, new Response(blob, { headers: response.headers }));
  partial.headers.set("Accept-Ranges", "bytes");
  return partial;
}

async function savedResponse(event: FetchEvent, entry: Entry): Promise<Response> {
  let response = await precache.matchPrecache(entry.url);
  if (!response) {
    event.waitUntil(notifyMissing());
    try {
      // Integrity prevents a new deployment from being stored as the old release.
      response = await restore(entry);
    } catch {
      return event.request.mode === "navigate" ? fallback() : new Response("Offline file unavailable", { status: 503 });
    }
  }
  if (entry.url.startsWith("/samples/") && event.request.headers.has("range")) {
    return sampleRangeResponse(event.request, response);
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const entry = entryFor(url);
  if (entry) {
    event.respondWith(savedResponse(event, entry));
  } else if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(fallback));
  }
});

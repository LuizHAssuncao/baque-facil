import { expect, test, chromium, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { cp, copyFile, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const origin = "http://127.0.0.1:4335";
const project = resolve(".");
const footer = "footer [data-offline-status]";
const sample = "/samples/alfaia/right-accent.wav";
let fixtures: string;
let releaseB: string;
let releaseC: string;

type BuildReport = { release: string; files: { url: string; file: string; integrity: string }[] };
const report = async (directory = join(project, "dist")): Promise<BuildReport> => JSON.parse(await readFile(join(directory, "offline-build.json"), "utf8"));

async function server(request: APIRequestContext, options: Record<string, unknown>) {
  const response = await request.post(`${origin}/__offline_test__`, { data: options });
  expect(response.ok()).toBeTruthy();
}

async function prepared(page: Page) {
  await page.goto("/");
  await expect(page.locator(footer)).toHaveAttribute("data-state", "saved");
  const language = page.getByRole("dialog");
  if (await language.isVisible()) await language.getByRole("button", { name: "English (Canada)", exact: true }).click();
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(false);
  await page.reload();
  await expect(page.locator(footer)).toHaveAttribute("data-ready", "true");
  await expect(page.locator(footer)).toHaveAttribute("data-release", (await report()).release);
}

async function workerStatus(page: Page, action = "status") {
  return page.evaluate(async (action) => {
    const registration = await navigator.serviceWorker.getRegistration();
    const worker = navigator.serviceWorker.controller ?? registration!.active!;
    return new Promise<{ ready: boolean; missing: number; release: string }>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = ({ data }) => { channel.port1.close(); resolve(data); };
      worker.postMessage({ type: "baque-facil-offline", action }, [channel.port2]);
    });
  }, action);
}

async function update(page: Page) {
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
}

async function newSession(context: BrowserContext, path = "/") {
  for (const page of context.pages()) await page.close();
  const page = await context.newPage();
  await page.goto(path);
  await expect(page.locator(footer)).toHaveAttribute("data-ready", "true");
  return page;
}

async function audioProbe(page: Page) {
  await page.addInitScript(() => {
    const voices: { leadingEnergy: number; hasSound: boolean; time: number }[] = [];
    (window as unknown as { offlineVoices: typeof voices }).offlineVoices = voices;
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        source.start = (when = 0, offset = 0) => {
          const pcm = source.buffer?.getChannelData(0);
          voices.push({
            leadingEnergy: pcm?.slice(0, 4410).reduce((total, value) => total + Math.abs(value), 0) ?? 0,
            hasSound: pcm?.some((value) => Math.abs(value) > 0.001) ?? false,
            time: when,
          });
          start(when, offset);
        };
        return source;
      }
    };
  });
}

async function leadingEnergy(page: Page) {
  return page.evaluate(() => (window as unknown as { offlineVoices: { leadingEnergy: number }[] }).offlineVoices.at(-1)?.leadingEnergy);
}

async function saveOfflineMp3(page: Page, name = "Save MP3") {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name, exact: true }).click();
  const download = await pending;
  expect(await download.failure()).toBeNull();
  const bytes = await readFile((await download.path())!);
  expect(bytes.length).toBeGreaterThan(1000);
  expect(await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (value) => value.charCodeAt(0));
    const audio = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(bytes.buffer);
    return audio.getChannelData(0).some((value) => Math.abs(value) > 0.01);
  }, bytes.toString("base64"))).toBe(true);
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  fixtures = await mkdtemp(join(tmpdir(), "baque-offline-builds-"));
  for (const file of ["src", "public", "scripts", "package.json", "astro.config.mjs", "tsconfig.json"]) {
    await cp(join(project, file), join(fixtures, file), { recursive: true });
  }
  await symlink(join(project, "node_modules"), join(fixtures, "node_modules"), "dir");
  const rhythm = join(fixtures, "src/content/rhythms/marcacao.md");
  await writeFile(rhythm, (await readFile(rhythm, "utf8")).replace("R . . . |", ". . . . |"));
  const build = () => execFileSync(process.execPath, [join(project, "node_modules/astro/astro.js"), "build"], {
    cwd: fixtures, env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" }, stdio: "pipe", maxBuffer: 5_000_000,
  });
  build();
  releaseB = join(fixtures, "build-b");
  await cp(join(fixtures, "dist"), releaseB, { recursive: true });
  await rm(join(fixtures, "src/content/rhythms/afoxe.md"));
  const map = join(fixtures, "src/lib/sampleMap.ts");
  await writeFile(map, (await readFile(map, "utf8")).replace("export const sampleMap: SampleMap = {", 'export const sampleMap: SampleMap = {\n  "Alfaia.N": "/samples/alfaia/new-hit.wav",'));
  await copyFile(join(fixtures, "public/samples/alfaia/border-hit.wav"), join(fixtures, "public/samples/alfaia/new-hit.wav"));
  await copyFile(join(fixtures, "public/samples/gongue/low-light.wav"), join(fixtures, "public/samples/alfaia/left-ghost.wav"));
  await writeFile(join(fixtures, "src/content/rhythms/offline-new.md"), '---\ntitle: "Offline new rhythm"\ntempo: 90\nsubdivision: 16\ndifficulty: "beginner"\ninstruments: ["Alfaia"]\n---\n\n```rhythm\nAlfaia:\nN . R .\n```\n');
  build();
  releaseC = join(fixtures, "dist");
});

test.afterAll(async () => { if (fixtures) await rm(fixtures, { recursive: true, force: true }); });
test.beforeEach(async ({ request, context }) => {
  await context.route("https://static.cloudflareinsights.com/**", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
  await context.addInitScript(() => {
    if (!localStorage.getItem("baque-facil-language")) localStorage.setItem("baque-facil-language", "en-CA");
  });
  await server(request, { directory: join(project, "dist"), blocked: "", corrupt: "", hold: "", reset: true });
});

test("Cloudflare HTML is verified against the build and missing pages repair on reconnect", async ({ page, context, request }) => {
  const entry = (await report()).files.find((entry) => entry.url === "/quiz/")!;
  expect(await (await request.get("/quiz/")).text()).toContain("<!-- Cloudflare Pages Analytics -->");
  await prepared(page);
  const cachedHtml = () => page.evaluate(async () => {
    const cache = await caches.open("baque-facil-precache-v1");
    const key = (await cache.keys()).find((key) => new URL(key.url).pathname === "/quiz/")!;
    return (await cache.match(key))!.text();
  });
  expect(`sha256-${createHash("sha256").update(await cachedHtml()).digest("base64")}`).toBe(entry.integrity);
  await page.evaluate(async () => {
    const cache = await caches.open("baque-facil-precache-v1");
    for (const key of await cache.keys()) if (new URL(key.url).pathname === "/quiz/") await cache.delete(key);
  });
  await context.setOffline(true);
  await expect(page.locator(footer)).toHaveAttribute("data-ready", "false");
  await context.setOffline(false);
  await expect(page.locator(footer)).toHaveAttribute("data-ready", "true");
  expect(`sha256-${createHash("sha256").update(await cachedHtml()).digest("base64")}`).toBe(entry.integrity);
  await context.setOffline(true);
  await page.goto("/quiz/");
  await expect(page.getByRole("button", { name: "Play audio A", exact: true })).toBeEnabled();
});

test("Cloudflare analytics does not hide changed HTML from integrity checks", async ({ page, request }) => {
  await server(request, { corrupt: "/rhythms/marcacao/" });
  await page.goto("/");
  await expect(page.locator(footer)).toHaveAttribute("data-state", "incomplete");
  const cached = await page.evaluate(async () => (await (await caches.open("baque-facil-precache-v1")).keys()).map((key) => new URL(key.url).pathname));
  expect(cached).not.toContain("/rhythms/marcacao/");
  await server(request, { corrupt: "" });
  await page.locator(footer).getByRole("button", { name: "Retry" }).click();
  await expect(page.locator(footer)).toHaveAttribute("data-state", "saved");
});

test("home-only setup saves all routes and lazy assets, with a discreet responsive footer", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await prepared(page);
  const cached = await page.evaluate(async () => (await (await caches.open("baque-facil-precache-v1")).keys()).map((key) => new URL(key.url).pathname));
  expect(cached.sort()).toEqual((await report()).files.map((file) => file.url).sort());
  await context.setOffline(true);
  for (const path of ["/rhythms/combo_entrada/", "/compose/combo_three_crossed_break/", "/help/ios-audio/", "/diagnostics/background-audio/", "/"]) {
    const response = await page.goto(path);
    expect(response!.fromServiceWorker()).toBe(true);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(footer)).toHaveAttribute("data-ready", "true");
    await expect(page.locator(footer)).toContainText("Offline · using saved rhythms");
  }
  for (const width of [1280, 500, 390]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(page.locator(footer)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(await page.locator(footer).evaluate((element) => getComputedStyle(element).position)).toBe("static");
  }
  expect(errors).toEqual([]);
});

test("player, composer, quiz, and fresh radio encoding work on first use offline", async ({ page, context }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await audioProbe(page);
  await prepared(page);
  await context.setOffline(true);
  await page.goto("/rhythms/marcacao/");
  await page.getByRole("button", { name: "Disable loop", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => leadingEnergy(page)).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("button", { name: "Download MP3", exact: true }).click();
  await page.getByLabel("Repetitions", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Prepare MP3", exact: true }).click();
  await saveOfflineMp3(page);

  await page.goto("/compose/");
  await page.getByRole("textbox", { name: "Transcription" }).fill("Alfaia:\nL R . . | R . L .");
  await expect(page.getByRole("button", { name: "Alfaia step 1: L", exact: true })).toBeVisible();
  await page.locator(".player-panel").getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".player-panel").getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { offlineVoices: { hasSound: boolean }[] }).offlineVoices.some((voice) => voice.hasSound))).toBe(true);
  await page.locator(".player-panel").getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByTitle("Left hand", { exact: true }).click();
  await page.getByRole("button", { name: "Turn metronome on", exact: true }).click();
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.locator(".composer-actions [aria-live]")).toHaveText("Recording");
  await page.getByTitle("Left hand", { exact: true }).click();
  await page.getByTitle("Right hand", { exact: true }).click();
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Transcription" })).toHaveValue(/[LR]/);
  await page.getByRole("button", { name: "Turn metronome off", exact: true }).click();
  await page.getByRole("button", { name: "Download MP3", exact: true }).click();
  await page.getByRole("button", { name: "Prepare MP3", exact: true }).click();
  await saveOfflineMp3(page);

  await page.goto("/quiz/");
  for (const label of ["A", "B", "C"]) {
    await page.getByRole("button", { name: `Play audio ${label}`, exact: true }).click();
    await expect(page.getByRole("button", { name: `Stop audio ${label}`, exact: true })).toBeVisible();
  }
  for (let index = 0; index < 3; index++) {
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(page.getByRole("button", { name: "Play audio A", exact: true })).toBeEnabled();
  }

  await page.evaluate(() => localStorage.setItem("baque-facil-radio-v1", JSON.stringify({ slugs: ["marcacao", "imale"], tempo: 90, repetitions: 4, minutes: 2 })));
  await page.goto("/radio/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible({ timeout: 30_000 });
  const audio = page.locator("audio[data-radio-player]");
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await page.getByRole("button", { name: "Stay on this rhythm", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to mix", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to mix", exact: true }).click();
  const previous = await audio.getAttribute("src");
  await page.getByRole("button", { name: "Shuffle again", exact: true }).click();
  await expect(audio).not.toHaveAttribute("src", previous!, { timeout: 30_000 });
  await saveOfflineMp3(page, "Download mix MP3");
  expect(errors).toEqual([]);
});

test("cached media supports byte ranges, URL variants, and an honest offline fallback", async ({ page, context }) => {
  await prepared(page);
  await context.setOffline(true);
  const responses = await page.evaluate(async (url) => {
    const full = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const partial = await fetch(url, { headers: { Range: "bytes=10-29" } });
    const invalid = await fetch(url, { headers: { Range: "bytes=999999999-" } });
    const suffix = await fetch(url, { headers: { Range: "bytes=-20" } });
    const oversized = await fetch(url, { headers: { Range: `bytes=${full.length - 10}-999999999` } });
    const reversed = await fetch(url, { headers: { Range: "bytes=20-10" } });
    const audio = new Audio(url);
    const loaded = new Promise<boolean>((resolve) => { audio.onloadeddata = () => resolve(true); audio.onerror = () => resolve(false); });
    audio.load();
    return { expected: Array.from(full.slice(10, 30)), actual: Array.from(new Uint8Array(await partial.arrayBuffer())), status: partial.status, range: partial.headers.get("content-range"), invalid: invalid.status, suffix: Array.from(new Uint8Array(await suffix.arrayBuffer())), suffixExpected: Array.from(full.slice(-20)), oversized: (await oversized.arrayBuffer()).byteLength, reversed: reversed.status, audioLoaded: await loaded };
  }, sample);
  expect(responses.actual).toEqual(responses.expected);
  expect(responses.status).toBe(206);
  expect(responses.range).toMatch(/^bytes 10-29\//);
  expect(responses.invalid).toBe(416);
  expect(responses.suffix).toEqual(responses.suffixExpected);
  expect(responses.oversized).toBe(10);
  expect(responses.reversed).toBe(416);
  expect(responses.audioLoaded).toBe(true);
  for (const path of ["/rhythms/marcacao", "/rhythms/marcacao/index.html", "/rhythms/marcacao/?utm_source=offline"]) {
    expect((await page.goto(path))!.fromServiceWorker()).toBe(true);
    await expect(page.locator("h1")).toHaveText("1 - Marcação");
  }
  await page.goto("/never-saved/");
  await expect(page.getByRole("heading", { name: "This page isn’t saved on your device", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "All rhythms", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("Baque Fácil");
  const manifest = await page.evaluate(async () => (await fetch("/manifest.webmanifest")).json());
  expect(manifest.scope).toBe("/");
  expect(manifest.display).toBe("standalone");
  for (const icon of manifest.icons) {
    expect(await page.evaluate(async (url) => (await fetch(url)).status, icon.src)).toBe(200);
  }
});

test("an interrupted first download can be retried without losing readiness accuracy", async ({ page, request }) => {
  await server(request, { blocked: "/encodeMix." });
  await page.goto("/");
  await expect(page.locator(footer)).toHaveAttribute("data-state", "incomplete");
  await expect(page.locator(footer)).not.toHaveAttribute("data-ready", "true");
  await server(request, { blocked: "" });
  await page.locator(footer).getByRole("button", { name: "Retry" }).click();
  await expect(page.locator(footer)).toHaveAttribute("data-state", "saved");
  await page.reload();
  await expect(page.locator(footer)).toHaveAttribute("data-ready", "true");
});

test("wrong deployment bytes fail integrity checks instead of being saved", async ({ page, request }) => {
  await server(request, { corrupt: "/encodeMix." });
  await page.goto("/");
  await expect(page.locator(footer)).toHaveAttribute("data-state", "incomplete");
  expect((await page.evaluate(async () => (await (await caches.open("baque-facil-precache-v1")).keys()).map((key) => key.url))).some((url) => url.includes("encodeMix."))).toBe(false);
  await server(request, { corrupt: "" });
  await page.locator(footer).getByRole("button", { name: "Retry" }).click();
  await expect(page.locator(footer)).toHaveAttribute("data-state", "saved");
});

test("quota failures leave the online app usable and allow a clean retry", async ({ page, context, request }) => {
  await server(request, { hold: "/samples/" });
  const workerPromise = context.waitForEvent("serviceworker");
  await page.goto("/");
  const worker = await workerPromise;
  await worker.evaluate(() => {
    const put = Cache.prototype.put;
    Cache.prototype.put = function (request, response) {
      const url = request instanceof Request ? request.url : String(request);
      if (url.includes("/samples/")) return Promise.reject(new DOMException("Test quota exhausted", "QuotaExceededError"));
      return put.call(this, request, response);
    };
  });
  await server(request, { hold: "" });
  await expect(page.locator(footer)).toHaveAttribute("data-state", "incomplete");
  await expect(page.getByRole("link", { name: /Listen to Baque Radio/ })).toBeVisible();
  await page.locator(footer).getByRole("button", { name: "Retry" }).click();
  await expect(page.locator(footer)).toHaveAttribute("data-state", "saved");
});

test("missing saved resources are detected offline and repaired on reconnect", async ({ page, context }) => {
  await prepared(page);
  await page.evaluate(async (path) => {
    const cache = await caches.open("baque-facil-precache-v1");
    for (const key of await cache.keys()) if (new URL(key.url).pathname === path) await cache.delete(key);
  }, sample);
  await context.setOffline(true);
  await expect(page.locator(footer)).toHaveAttribute("data-ready", "false");
  expect((await workerStatus(page)).missing).toBe(1);
  await context.setOffline(false);
  await expect(page.locator(footer)).toHaveAttribute("data-ready", "true");
  expect((await workerStatus(page)).missing).toBe(0);
});

test("Settings refresh replaces every saved file and a waiting release while keeping preferences", async ({ page, request, context }) => {
  await prepared(page);
  await page.locator("#settings summary").click();
  await page.getByRole("checkbox", { name: /Left-handed mode/ }).check();
  await page.evaluate(async (path) => {
    localStorage.setItem("baque-facil-radio-v1", "keep-radio-preferences");
    await (await caches.open("baque-facil-obsolete-v0")).put("/obsolete", new Response("old"));
    await (await caches.open("unrelated-app-cache")).put("/unrelated", new Response("keep"));
    const cache = await caches.open("baque-facil-precache-v1");
    const key = (await cache.keys()).find((key) => new URL(key.url).pathname === path)!;
    await cache.put(key, new Response("corrupt sample"));
  }, sample);
  await server(request, { directory: releaseB });
  await update(page);
  await expect(page.locator(footer)).toHaveAttribute("data-state", "update-ready");
  await server(request, { reset: true });
  await page.getByRole("button", { name: "Refresh offline app", exact: true }).click();
  await expect(page.locator("[data-offline-refresh-message]")).toHaveText("Offline app refreshed.");
  await expect(page.locator(footer)).toHaveAttribute("data-ready", "true");
  await expect(page.locator(footer)).toHaveAttribute("data-release", (await report(releaseB)).release);
  await expect(page.getByRole("checkbox", { name: /Left-handed mode/ })).toBeChecked();
  const storage = await page.evaluate(async (path) => ({
    caches: await caches.keys(),
    radio: localStorage.getItem("baque-facil-radio-v1"),
    language: localStorage.getItem("baque-facil-language"),
    sampleSize: (await (await fetch(path)).arrayBuffer()).byteLength,
    keys: (await (await caches.open("baque-facil-precache-v1")).keys()).map((key) => new URL(key.url).pathname),
    waiting: Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
  }), sample);
  expect(storage.caches).not.toContain("baque-facil-obsolete-v0");
  expect(storage.caches).toContain("unrelated-app-cache");
  expect(storage.radio).toBe("keep-radio-preferences");
  expect(storage.language).toBe("en-CA");
  expect(storage.sampleSize).toBe((await readFile(join(project, "public", sample))).length);
  expect(storage.keys.sort()).toEqual((await report(releaseB)).files.map((file) => file.url).sort());
  expect(storage.waiting).toBe(false);
  const counts = (await (await request.get(`${origin}/__offline_test__`)).json()).counts;
  for (const file of (await report(releaseB)).files) expect(counts[file.url], file.url).toBeGreaterThan(0);
  await context.setOffline(true);
  await page.goto("/quiz/");
  await expect(page.getByRole("button", { name: "Play audio A", exact: true })).toBeEnabled();
});

test("Settings refresh stays translated and preserves the saved app when disconnected or unreachable", async ({ page, context, request }) => {
  await prepared(page);
  await page.locator("#settings summary").click();
  for (const [locale, name, button] of [["pt-BR", "Português (Brasil)", "Atualizar app offline"], ["en-CA", "English (Canada)", "Refresh offline app"]]) {
    await page.locator(".language-settings").getByRole("button", { name, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("button", { name: button, exact: true })).toBeEnabled();
    await expect(page.getByRole("status", { name: locale === "pt-BR" ? "Acesso offline" : "Offline access", exact: true })).toHaveText(locale === "pt-BR" ? "Pronto para usar offline" : "Ready for offline use");
    for (const width of [1280, 500, 390]) {
      await page.setViewportSize({ width, height: 850 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
  }
  const release = (await workerStatus(page)).release;
  await context.setOffline(true);
  await expect(page.getByRole("button", { name: "Refresh offline app", exact: true })).toBeDisabled();
  await expect(page.locator("[data-offline-refresh-message]")).toHaveText("Connect to the internet to refresh the offline app.");
  expect((await workerStatus(page)).ready).toBe(true);
  await context.setOffline(false);
  await server(request, { blocked: "/offline-build.json" });
  await page.getByRole("button", { name: "Refresh offline app", exact: true }).click();
  await expect(page.locator("[data-offline-refresh-message]")).toContainText("Your saved app is unchanged");
  expect(await workerStatus(page)).toMatchObject({ release, ready: true, missing: 0 });
  await expect(page.locator(footer)).toHaveAttribute("data-ready", "true");
  await context.setOffline(true);
  await page.goto("/rhythms/marcacao/");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
});

test("Settings refresh protects another tab's unsaved composition", async ({ page, context }) => {
  await prepared(page);
  const composer = await context.newPage();
  await composer.goto("/compose/");
  const draft = "Alfaia:\nB R L .";
  await composer.getByRole("textbox", { name: "Transcription", exact: true }).fill(draft);
  await page.locator("#settings summary").click();
  await page.getByRole("button", { name: "Refresh offline app", exact: true }).click();
  await expect(page.locator("[data-offline-refresh-message]")).toHaveText("Close other Baque Fácil tabs or windows, then try again.");
  await expect(composer.getByRole("textbox", { name: "Transcription", exact: true })).toHaveValue(draft);
  expect((await workerStatus(page)).ready).toBe(true);
  await composer.close();
  await page.getByRole("button", { name: "Refresh offline app", exact: true }).click();
  await expect(page.locator("[data-offline-refresh-message]")).toHaveText("Offline app refreshed.");
  await expect(page.locator(footer)).toHaveAttribute("data-ready", "true");
});

test("Settings refresh can recover after the replacement download fails", async ({ page, request }) => {
  await prepared(page);
  await page.locator("#settings summary").click();
  await server(request, { blocked: sample });
  await page.getByRole("button", { name: "Refresh offline app", exact: true }).click();
  await expect(page.locator("[data-offline-refresh-message]")).toHaveText("The refresh didn’t finish. Stay online and try again.");
  await expect(page.locator(footer)).toHaveAttribute("data-ready", "false");
  await expect(page.getByRole("button", { name: "Refresh offline app", exact: true })).toBeEnabled();
  await server(request, { blocked: "" });
  await page.getByRole("button", { name: "Refresh offline app", exact: true }).click();
  await expect(page.locator("[data-offline-refresh-message]")).toHaveText("Offline app refreshed.");
  await expect(page.locator(footer)).toHaveAttribute("data-ready", "true");
});

test("a changed sequence waits for every old tab, then updates all surfaces offline", async ({ page, context, request }) => {
  test.setTimeout(90_000);
  await audioProbe(page);
  await prepared(page);
  await page.goto("/rhythms/marcacao/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  const composer = await context.newPage();
  await composer.goto("/compose/marcacao/");
  const draft = "Alfaia:\nB R L .";
  await composer.getByRole("textbox", { name: "Transcription" }).fill(draft);
  await server(request, { directory: releaseB, reset: true });
  await update(page);
  await expect(page.locator(footer)).toHaveAttribute("data-state", "update-ready");
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await expect(composer.getByRole("textbox", { name: "Transcription" })).toHaveValue(draft);
  expect((await workerStatus(page)).release).toBe((await report()).release);
  const counts = (await (await request.get(`${origin}/__offline_test__`)).json()).counts;
  expect(Object.keys(counts).filter((url) => url.startsWith("/samples/"))).toEqual([]);
  await page.close();
  await composer.reload();
  await expect(composer.locator(footer)).toHaveAttribute("data-state", "update-ready");
  expect((await workerStatus(composer)).release).toBe((await report()).release);
  await context.setOffline(true);
  const next = await newSession(context, "/rhythms/marcacao/");
  await expect(next.locator(footer)).toHaveAttribute("data-release", (await report(releaseB)).release);
  await expect(next.locator(".player-panel .grid-row:not(.count-row) .step-cell").first()).toHaveText(".");
  await audioProbe(next);
  await next.reload();
  await next.getByRole("button", { name: "Disable loop", exact: true }).click();
  await next.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => leadingEnergy(next)).toBe(0);
  await next.goto("/compose/marcacao/");
  await expect(next.getByRole("textbox", { name: "Transcription" })).toHaveValue(/Alfaia:\n\. \. \. \./);
  await next.evaluate(() => localStorage.setItem("baque-facil-radio-v1", JSON.stringify({ slugs: ["marcacao"], tempo: 90, repetitions: 4, minutes: 2 })));
  await next.goto("/radio/");
  await next.getByRole("button", { name: "Play", exact: true }).click();
  await expect(next.getByRole("button", { name: "Pause", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(next.locator(".radio-pattern .grid-row:not(.count-row) .step-cell").first()).toHaveText(".");
  await next.goto("/quiz/");
  await expect(next.getByRole("button", { name: "Play audio A", exact: true })).toBeEnabled();
  expect(await next.evaluate(async () => (await (await fetch("/quiz/rhythms.json", { cache: "no-store" })).json()).rhythms.find((rhythm: { slug: string }) => rhythm.slug === "marcacao").tracks[0].steps[0])).toBe(".");
});

test("a failed update preserves the saved app; changed inventory activates together and cleans old entries", async ({ page, context, request }) => {
  await prepared(page);
  await page.evaluate(() => localStorage.setItem("offline-test-preference", "keep"));
  await server(request, { directory: releaseC, blocked: "/samples/alfaia/new-hit.wav" });
  await update(page);
  await expect(page.locator(footer)).toHaveAttribute("data-state", "update-failed");
  await context.setOffline(true);
  let next = await newSession(context, "/rhythms/afoxe/");
  await expect(next.locator("h1")).toHaveText("Afoxé");
  expect((await workerStatus(next)).release).toBe((await report()).release);
  await server(request, { blocked: "" });
  await context.setOffline(false);
  await update(next);
  await expect(next.locator(footer)).toHaveAttribute("data-state", "update-ready");
  await context.setOffline(true);
  next = await newSession(context, "/rhythms/offline-new/");
  await expect(next.locator("h1")).toHaveText("Offline new rhythm");
  await next.getByRole("button", { name: "Play", exact: true }).click();
  await expect(next.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  expect((await workerStatus(next)).release).toBe((await report(releaseC)).release);
  expect(await next.evaluate(() => localStorage.getItem("offline-test-preference"))).toBe("keep");
  const keys = await next.evaluate(async () => (await (await caches.open("baque-facil-precache-v1")).keys()).map((key) => new URL(key.url).pathname));
  expect(keys).not.toContain("/rhythms/afoxe/");
  expect(keys).toContain("/samples/alfaia/new-hit.wav");
  const length = await next.evaluate(async () => (await (await fetch("/samples/alfaia/left-ghost.wav")).arrayBuffer()).byteLength);
  expect(length).toBe(26504);
  await next.goto("/rhythms/afoxe/");
  await expect(next.getByRole("heading", { name: "This page isn’t saved on your device", exact: true })).toBeVisible();
});

test("the saved site survives a complete browser restart in airplane mode", async () => {
  const profile = await mkdtemp(join(tmpdir(), "baque-offline-profile-"));
  const launch = () => chromium.launchPersistentContext(profile, {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    channel: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? undefined : "chrome",
    baseURL: origin,
  });
  let context = await launch();
  try {
    await prepared(context.pages()[0]);
    await context.close();
    context = await launch();
    await context.setOffline(true);
    const page = context.pages()[0];
    expect((await page.goto("/quiz/"))!.fromServiceWorker()).toBe(true);
    await expect(page.getByRole("button", { name: "Play audio A", exact: true })).toBeEnabled();
    await expect(page.locator(footer)).toHaveAttribute("data-ready", "true");
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("browsers without service workers keep their normal online experience", async ({ page }) => {
  await page.addInitScript(() => { Reflect.deleteProperty(Navigator.prototype, "serviceWorker"); });
  await page.goto("/quiz/");
  await expect(page.locator(footer)).toHaveAttribute("data-state", "unavailable");
  await expect(page.getByRole("button", { name: "Play audio A", exact: true })).toBeEnabled();
});

import { expect, test, type Page } from "@playwright/test";

async function openPlayer(page: Page) {
  await page.goto("/rhythms/marcacao/");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  return page.locator("audio[data-rendered-player]");
}

test("media playback starts, changes tempo, loops, and stops", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const audio = await openPlayer(page);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0.1);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.loop)).toBe(true);
  const originalSource = await audio.getAttribute("src");
  await page.getByRole("slider", { name: "Tempo" }).fill("110");
  await expect(page.getByRole("status", { name: "Playback status" })).toContainText("Playing 110 BPM", { timeout: 15_000 });
  expect(await audio.getAttribute("src")).not.toBe(originalSource);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.playbackRate)).toBe(1);
  // Exercise the native file boundary without waiting for the full rendered track.
  await audio.evaluate((element: HTMLAudioElement) => { element.currentTime = element.duration - 0.15; });
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeLessThan(1);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeLessThan(1);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBe(0);
  expect(errors).toEqual([]);
});

test("latest tempo wins and finishing preparation cannot undo Stop", async ({ page }) => {
  const audio = await openPlayer(page);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Tempo" });
  await slider.fill("30");
  await slider.fill("130");
  await slider.fill("100");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("status", { name: "Playback status" })).toContainText("Tap Play");
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("status", { name: "Playback status" })).toContainText("Playing 100 BPM");
});

test("mute regenerates the mix and one-shot playback finishes", async ({ page }) => {
  const audio = await openPlayer(page);
  const originalSource = await audio.getAttribute("src");
  await page.getByRole("button", { name: "Mute Alfaia", exact: true }).click();
  await expect.poll(() => audio.getAttribute("src")).not.toBe(originalSource);
  const peak = await audio.evaluate(async (element: HTMLAudioElement) => {
    const bytes = await (await fetch(element.src)).arrayBuffer();
    const buffer = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(bytes);
    return buffer.getChannelData(0).reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  });
  expect(peak).toBe(0);
  await page.getByRole("button", { name: "Unmute Alfaia", exact: true }).click();
  await page.getByRole("button", { name: "Disable loop", exact: true }).click();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.loop)).toBe(false);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible({ timeout: 10_000 });
  expect(await audio.evaluate((element: HTMLAudioElement) => element.ended)).toBe(true);
});

test("hidden page keeps its current track until a visible update can apply", async ({ page }) => {
  const audio = await openPlayer(page);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const originalSource = await audio.getAttribute("src");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.getByRole("slider", { name: "Tempo" }).fill("120");
  await expect(page.getByRole("status", { name: "Playback status" })).toContainText("Update ready");
  expect(await audio.getAttribute("src")).toBe(originalSource);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);
  await page.evaluate(() => {
    delete (document as unknown as { hidden?: boolean }).hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByRole("status", { name: "Playback status" })).toContainText("Playing 120 BPM", { timeout: 15_000 });
});

test("sample failures can be retried without reloading", async ({ page }) => {
  await page.route("**/samples/**", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
  await page.goto("/rhythms/marcacao/");
  await expect(page.locator(".player-status")).toContainText("Unable to load");
  await page.unroute("**/samples/**");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("status", { name: "Playback status" })).toContainText("Tap Play");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
});

test("renderer places hits at each subdivision and preserves loop tails without clipping", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/lib/audio/renderRhythm.ts";
    const { renderRhythm } = await import(/* @vite-ignore */ modulePath);
    const rate = 44100;
    const impulse = new AudioBuffer({ length: 100, sampleRate: rate });
    impulse.getChannelData(0)[0] = 0.5;
    const cache = { load: async () => impulse };
    const timings = [];
    for (const subdivision of [8, 16, 32]) {
      const rendered = await renderRhythm({
        rhythm: { subdivision, tracks: [{ name: "Test", steps: [".", "X", ".", "."] }] },
        samples: { "Test.X": "unused" }, tempo: 120, loop: false, mutedTracks: [],
      }, cache);
      const decoded = await new OfflineAudioContext(2, 1, rate).decodeAudioData(await rendered.blob.arrayBuffer());
      timings.push(decoded.getChannelData(0).findIndex((value: number) => Math.abs(value) > 0.1) / rate);
    }
    const tail = new AudioBuffer({ length: rate, sampleRate: rate });
    tail.getChannelData(0).fill(0.8);
    const request = {
      rhythm: { subdivision: 16, tracks: [{ name: "Test", steps: ["X"] }] },
      samples: { "Test.X": "unused" }, tempo: 120, loop: true, mutedTracks: [],
    };
    const looped = await renderRhythm(request, { load: async () => tail });
    const loopBuffer = await new OfflineAudioContext(2, 1, rate).decodeAudioData(await looped.blob.arrayBuffer());
    const data = loopBuffer.getChannelData(0);
    const oneShot = await renderRhythm({ ...request, loop: false }, { load: async () => tail });
    const oneBuffer = await new OfflineAudioContext(2, 1, rate).decodeAudioData(await oneShot.blob.arrayBuffer());
    return {
      timings,
      peak: data.reduce((max: number, value: number) => Math.max(max, Math.abs(value)), 0),
      first: data[0], last: data[data.length - 1],
      nextCycleFirst: data[Math.round(looped.cycleDuration * rate)],
      firstCycleLast: data[Math.round(looped.cycleDuration * rate) - 1],
      cycles: loopBuffer.duration / looped.cycleDuration,
      tailDuration: oneBuffer.duration,
    };
  });
  expect(result.timings[0]).toBeCloseTo(0.25, 4);
  expect(result.timings[1]).toBeCloseTo(0.125, 4);
  expect(result.timings[2]).toBeCloseTo(0.0625, 4);
  expect(result.peak).toBeLessThanOrEqual(0.981);
  expect(result.first).toBeGreaterThan(0.9);
  expect(result.first).toBeCloseTo(result.nextCycleFirst, 4);
  expect(result.last).toBeCloseTo(result.firstCycleLast, 4);
  expect(result.cycles).toBeCloseTo(Math.round(result.cycles), 8);
  expect(result.tailDuration).toBeCloseTo(1, 4);
});

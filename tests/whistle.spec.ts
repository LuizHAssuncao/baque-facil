import { expect, test } from "@playwright/test";
import { chooseNote, openTranscription } from "./composer-helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("baque-facil-language", "en-CA"));
});

test("whistle tracks support editing, playback, mutes, drafts and sharing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/compose/");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  const transcription = await openTranscription(page);
  await transcription.fill("Alfaia:\nL . R . | . . . .\n\nWhistle:\nX . . . | . . . .");
  await expect(transcription).toHaveAttribute("aria-invalid", "false");
  await chooseNote(page, "Whistle step 1: X", "Rest");
  const sampleLoaded = page.waitForResponse("**/samples/whistle/whistle.wav");
  await chooseNote(page, "Whistle step 2: .", "Hit");
  expect((await sampleLoaded).ok()).toBe(true);
  await expect(transcription).toHaveValue(/Whistle:\n\. X \. \. \| \. \. \. \./);
  await expect(page.getByRole("button", { name: "Alfaia step 1: L", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mute Whistle", exact: true }).click();
  await page.getByRole("button", { name: "Unmute Whistle", exact: true }).click();
  await page.getByRole("slider", { name: "Tempo", exact: true }).fill("110");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByText("Saved on this device", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Whistle step 2: X", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Share rhythm", exact: true }).click();
  const shared = await page.getByRole("textbox", { name: "Rhythm link", exact: true }).inputValue();
  await page.goto(shared);
  await expect(page.getByRole("button", { name: "Whistle step 2: X", exact: true })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Tempo", exact: true })).toHaveValue("110");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("the whistle recording renders with its decay, loops, mutes and exports to MP3", async ({ page }) => {
  await page.goto("/compose/");
  const result = await page.evaluate(async () => {
    const samplePath = "/src/lib/sampleMap.ts";
    const renderPath = "/src/lib/audio/renderRhythm.ts";
    const cachePath = "/src/lib/audio/sampleCache.ts";
    const exportPath = "/src/lib/audio/exportMp3.ts";
    const { sampleEntriesForRhythm } = await import(/* @vite-ignore */ samplePath);
    const { renderRhythm } = await import(/* @vite-ignore */ renderPath);
    const { SampleCache } = await import(/* @vite-ignore */ cachePath);
    const { exportMp3 } = await import(/* @vite-ignore */ exportPath);
    const rhythm = {
      title: "Whistle test", slug: "whistle-test", tempo: 120, subdivision: 16,
      tracks: [{ name: "Whistle", steps: [".", ".", ".", ".", ".", ".", ".", "X"] }],
    };
    const samples = sampleEntriesForRhythm(rhythm);
    const cache = new SampleCache();
    const request = { rhythm, samples, tempo: 120, loop: false, mutedTracks: [] };
    const finite = await renderRhythm(request, cache);
    const loop = await renderRhythm({ ...request, loop: true }, cache);
    const muted = await renderRhythm({ ...request, mutedTracks: ["Whistle"] }, cache);
    const exported = await exportMp3({ ...request, repetitions: 1 }, new AbortController().signal, () => {});
    const decoded = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(await exported.blob.arrayBuffer());
    const peak = (data: Float32Array) => data.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    return {
      duration: finite.buffer.duration,
      cycle: loop.buffer.duration,
      peak: peak(finite.buffer.getChannelData(0)),
      leadingRest: peak(finite.buffer.getChannelData(0).slice(0, 38000)),
      loopStart: peak(loop.buffer.getChannelData(0).slice(0, 10000)),
      muted: peak(muted.buffer.getChannelData(0)),
      mp3Type: exported.blob.type,
      mp3Frames: decoded.length,
      renderedFrames: finite.buffer.length,
      mp3Peak: peak(decoded.getChannelData(0)),
    };
  });
  expect(result.duration).toBeGreaterThan(1.4);
  expect(result.duration).toBeLessThan(1.5);
  expect(result.cycle).toBe(1);
  expect(result.peak).toBeGreaterThan(0.1);
  expect(result.leadingRest).toBe(0);
  expect(result.loopStart).toBeGreaterThan(0.1);
  expect(result.muted).toBe(0);
  expect(result.mp3Type).toBe("audio/mpeg");
  expect(result.mp3Frames).toBe(result.renderedFrames);
  expect(result.mp3Peak).toBeGreaterThan(0.1);
});

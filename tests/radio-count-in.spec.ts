import { expect, test, type Locator, type Page } from "@playwright/test";
import { buildRadioHits } from "../src/lib/radio/mixer";
import { buildRadioTimeline, radioPosition, RADIO_SAMPLE_RATE, withRadioCountIn } from "../src/lib/radio/timeline";
import type { Rhythm } from "../src/lib/rhythmTypes";

const settings = { tempo: 120, repetitions: 4, minutes: 2 };
const countInSeconds = 240 / settings.tempo;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("baque-facil-language", "en-CA"));
});

test("the opening call delays every instrument and transition by exactly one bar", () => {
  const makeRhythm = (slug: string, length = 16): Rhythm => ({
    title: slug, slug, tempo: 90, subdivision: 16,
    tracks: [{ name: "Alfaia", steps: Array.from({ length }, (_, step) => step % 4 === 0 ? "R" : ".") }],
  });
  for (const tempo of [30, 90, 130]) {
    for (const rhythms of [
      [makeRhythm("marcacao")],
      [makeRhythm("combo-test", 144)],
      [makeRhythm("marcacao"), makeRhythm("imale")],
    ]) {
      const base = buildRadioTimeline(rhythms, tempo, 4, 1, () => 0.99);
      const timeline = withRadioCountIn(base);
      const frames = Math.round(240 / tempo * RADIO_SAMPLE_RATE);
      expect(timeline.totalFrames).toBe(base.totalFrames + frames);
      expect(base.segments[0].startFrame).toBe(0);
      expect(withRadioCountIn(timeline)).toBe(timeline);
      expect(timeline.segments).toEqual(base.segments.map((segment) => ({
        ...segment,
        startFrame: segment.startFrame + frames,
        endFrame: segment.endFrame + frames,
        ...(segment.transitionStartFrame === undefined ? {} : { transitionStartFrame: segment.transitionStartFrame + frames }),
      })));
      const hits = buildRadioHits(timeline, rhythms);
      expect(hits.filter((hit) => hit.frame < frames)).toEqual([0, 8, 9, 11, 12, 14].map((step) => ({
        sample: "Whistle.X", frame: Math.round(step * frames / 16),
      })));
      expect(hits.filter((hit) => hit.frame >= frames)).toEqual(buildRadioHits(base, rhythms).map((hit) => ({
        ...hit, frame: hit.frame + frames,
      })));
      expect(radioPosition(timeline, 0)).toMatchObject({
        index: -1, countingIn: true, activeStep: 0, repetition: 0, signalDue: true,
        segment: timeline.segments[0], nextSegment: timeline.segments[0],
      });
      expect(radioPosition(timeline, (frames - 1) / RADIO_SAMPLE_RATE)).toMatchObject({ countingIn: true, activeStep: 15 });
      expect(radioPosition(timeline, frames / RADIO_SAMPLE_RATE)).toMatchObject({
        index: 0, countingIn: false, activeStep: 0, repetition: 1,
      });
      expect(radioPosition(timeline, timeline.totalFrames / RADIO_SAMPLE_RATE).countingIn).toBe(true);
      expect(radioPosition(base, 0)).toMatchObject({ countingIn: false, repetition: 1, activeStep: 0 });
    }
  }
});

test("the encoded MP3 opens with whistle audio and no wrapped drum decay", async ({ page }) => {
  await page.goto("/radio/");
  const result = await page.evaluate(async () => {
    const timelinePath = "/src/lib/radio/timeline.ts";
    const encoderPath = "/src/lib/radio/encodeMix.ts";
    const { buildRadioTimeline, withRadioCountIn, RADIO_SAMPLE_RATE: rate } = await import(/* @vite-ignore */ timelinePath);
    const { encodeMix } = await import(/* @vite-ignore */ encoderPath);
    const rhythm = {
      title: "Test", slug: "test", tempo: 120, subdivision: 16,
      // The final hit's long decay would leak into the count-in if wrapped.
      tracks: [{ name: "Test", steps: ["X", ...Array(14).fill("."), "X"] }],
    };
    const timeline = withRadioCountIn(buildRadioTimeline([rhythm], 120, 1, 1));
    const sample = (frequency: number) => Float32Array.from({ length: rate / 2 }, (_, frame) =>
      0.5 * Math.sin(frame * 2 * Math.PI * frequency / rate) * Math.exp(-frame / (rate / 5)),
    );
    // Separate channels let the decoded MP3 reveal even faint instrument leakage.
    const silence = new Float32Array(rate / 2);
    const blob = await encodeMix({
      timeline, rhythms: [rhythm],
      samples: {
        "Whistle.X": { left: sample(2200), right: silence },
        "Test.X": { left: silence, right: sample(220) },
      },
    }, () => {}, new AbortController().signal);
    const buffer = await new OfflineAudioContext(2, 1, rate).decodeAudioData(await blob.arrayBuffer());
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    const rms = (data: Float32Array, start: number, end: number) => {
      const part = data.subarray(Math.round(start * rate), Math.round(end * rate));
      return Math.sqrt(part.reduce((sum, value) => sum + value * value, 0) / part.length);
    };
    return {
      frames: buffer.length, expectedFrames: timeline.totalFrames,
      openingWhistle: rms(left, 0, 0.1),
      openingDrums: rms(right, 0, 1.9),
      drumsAfterCall: rms(right, 2, 2.1),
      firstDrum: right.findIndex((value) => Math.abs(value) > 0.05) / rate,
    };
  });
  expect(result.frames).toBe(result.expectedFrames);
  expect(result.openingWhistle).toBeGreaterThan(0.02);
  expect(result.openingDrums).toBeLessThan(0.0001);
  expect(result.drumsAfterCall).toBeGreaterThan(0.1);
  expect(result.firstDrum).toBeCloseTo(2, 2);
});

async function seek(audio: Locator, seconds: number) {
  await audio.evaluate((element: HTMLAudioElement, time) => {
    element.currentTime = time;
    element.dispatchEvent(new Event("timeupdate"));
  }, seconds);
}

async function openRadio(page: Page, slugs: string[]) {
  await page.addInitScript((value) => localStorage.setItem("baque-facil-radio-v1", JSON.stringify(value)), { ...settings, slugs });
  await page.goto("/radio/");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible({ timeout: 25_000 });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const audio = page.locator("audio[data-radio-player]");
  await seek(audio, 0);
  await expect(page.locator(".radio-cue")).toHaveAttribute("data-phase", "count-in");
  return audio;
}

for (const slug of ["marcacao", "combo_parada_arrasto"]) {
  test(`${slug} shows its first gesture and a whistle-only grid before the instruments enter`, async ({ page }, testInfo) => {
    const audio = await openRadio(page, [slug]);
    const source = await audio.getAttribute("src");
    const title = await page.locator(".radio-now h2").innerText();
    const cue = page.getByRole("region", { name: "First rhythm signal", exact: true });
    const grid = page.getByRole("region", { name: "Whistle count-in", exact: true });
    await expect(cue.locator("img")).toHaveAttribute("src", `/hand-signals/${slug}.png`);
    await expect(cue.locator(".radio-next")).toHaveText(`First rhythm: ${title}`);
    await expect(cue).toContainText("Start playing after the whistle call.");
    await expect(grid.locator(".grid-row:not(.count-row) .track-name")).toHaveText(["Whistle"]);
    await expect(grid.locator(".count-cell:disabled")).toHaveCount(16);
    await expect(page.getByRole("button", { name: "Stay on this rhythm", exact: true })).toBeDisabled();
    await expect.poll(() => cue.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await page.locator(".radio-player").screenshot({ path: testInfo.outputPath("radio-opening-call.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await seek(audio, 1);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(1.05);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    expect(await audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(1);

    await seek(audio, countInSeconds - 1 / RADIO_SAMPLE_RATE);
    await expect(page.locator(".radio-cue")).toHaveAttribute("data-phase", "count-in");
    await expect(page.locator(".count-cell").nth(15)).toHaveClass(/active/);
    await seek(audio, countInSeconds);
    await expect(page.locator(".radio-cue")).toHaveAttribute("data-phase", "repeating");
    await expect(page.locator(".radio-now h2")).toHaveText(title);
    await expect(page.locator(".radio-pattern-heading")).toContainText(`Repetition 1 of ${slug === "marcacao" ? 4 : 1}`);
    await expect(page.locator(".radio-pattern .track-name", { hasText: /^Alfaia$/ })).toBeVisible();
    await expect(page.locator(".radio-pattern .track-name", { hasText: /^Whistle$/ })).toHaveCount(0);
    await expect(page.locator(".count-cell").first()).toHaveClass(/active/);
    await expect(page.getByRole("button", { name: "Stay on this rhythm", exact: true })).toBeEnabled();
    await expect(audio).toHaveAttribute("src", source!);
  });
}

test("the call translates, can skip to the first rhythm, and returns on the native file loop", async ({ page }) => {
  const audio = await openRadio(page, ["marcacao", "imale"]);
  const firstTitle = await page.locator(".radio-now h2").innerText();
  const source = await audio.getAttribute("src");
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.locator(".radio-cue")).toHaveAttribute("data-phase", "waiting");
  await expect(page.locator(".radio-now h2")).toHaveText(firstTitle);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeCloseTo(countInSeconds, 4);

  await audio.evaluate((element: HTMLAudioElement) => { element.currentTime = element.duration - 0.1; });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeLessThan(countInSeconds);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.locator(".radio-cue")).toHaveAttribute("data-phase", "count-in");
  await expect(page.locator(".radio-now h2")).toHaveText(firstTitle);

  await page.getByRole("button", { name: "Português (Brasil)", exact: true }).click();
  await expect(page.getByRole("region", { name: "Sinal do primeiro ritmo", exact: true })).toContainText("Comece a tocar após a chamada do apito.");
  await expect(page.getByRole("region", { name: "Chamada inicial do apito", exact: true })).toContainText("Apito");
  await expect(audio).toHaveAttribute("src", source!);
});

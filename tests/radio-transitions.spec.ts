import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { extractRhythmBlock } from "../src/lib/extractRhythmBlock";
import { parseRhythm } from "../src/lib/parseRhythm";
import { buildRadioHits } from "../src/lib/radio/mixer";
import { buildRadioTimeline, radioPosition, RADIO_SAMPLE_RATE } from "../src/lib/radio/timeline";
import type { Rhythm } from "../src/lib/rhythmTypes";

const rhythms: Rhythm[] = ["marcacao", "imale"].map((slug) => ({
  title: slug,
  slug,
  tempo: 90,
  subdivision: 16,
  tracks: parseRhythm(extractRhythmBlock(readFileSync(
    new URL(`../src/content/rhythms/${slug}.md`, import.meta.url), "utf8",
  ))!),
}));

const alfaiaTransition = "R . . . . . . . L R . R L . R .".split(" ");
const whistleTransition = "X . . . . . . . X X . X X . X .".split(" ");

test("radio renders the exact six-bar alfaia and whistle example", () => {
  const original = structuredClone(rhythms);
  const timeline = buildRadioTimeline(rhythms, 120, 3, 1, () => 0.99);
  const expected = parseRhythm(`Alfaia:
R . . . | . . . . | L R . . | L R . .
R . . . | . . . . | L R . . | L R . .
R . . . | . . . . | L R . R | L . R .
R . . . | L . R . | L R . . | L R . .
R . . . | L . R . | L R . . | L R . .
R . . . | . . . . | L R . R | L . R .

Whistle:
. . . . | . . . . | . . . . | . . . .
. . . . | . . . . | . . . . | . . . .
X . . . | . . . . | X X . X | X . X .
. . . . | . . . . | . . . . | . . . .
. . . . | . . . . | . . . . | . . . .
X . . . | . . . . | X X . X | X . X .`);
  const expectedHits = expected.flatMap((track) => track.steps.flatMap((symbol, step) =>
    symbol === "." ? [] : [{ frame: Math.round(step * 0.125 * RADIO_SAMPLE_RATE), sample: `${track.name}.${symbol}` }],
  )).sort((left, right) => left.frame - right.frame);

  expect(timeline.segments.map((segment) => segment.slug)).toEqual(["marcacao", "imale"]);
  expect(timeline.totalFrames).toBe(12 * RADIO_SAMPLE_RATE);
  expect(buildRadioHits(timeline, rhythms)).toEqual(expectedHits);
  expect(rhythms).toEqual(original);
});

test("only the final repetition changes across tempo bounds and repetition settings", () => {
  for (const tempo of [30, 90, 130]) {
    for (const repetitions of [1, 4, 8, 16]) {
      const timeline = buildRadioTimeline(rhythms, tempo, repetitions, 1, () => 0.99);
      const cycleFrames = Math.round(4 * 60 / tempo * RADIO_SAMPLE_RATE);
      expect(timeline.totalFrames).toBe(cycleFrames * repetitions * 2);
      for (const segment of timeline.segments) {
        const start = segment.endFrame - segment.cycleFrames;
        if (repetitions > 1) {
          expect(radioPosition(timeline, (start - 1) / RADIO_SAMPLE_RATE).transitionTracks).toBeNull();
        }
        const position = radioPosition(timeline, start / RADIO_SAMPLE_RATE);
        expect(position.repetition).toBe(repetitions);
        expect(position.activeStep).toBe(0);
        expect(position.transitionTracks).toEqual([
          { name: "Alfaia", steps: alfaiaTransition },
          { name: "Whistle", steps: whistleTransition },
        ]);
        expect(radioPosition(timeline, (segment.endFrame - 1) / RADIO_SAMPLE_RATE).transitionTracks).not.toBeNull();
        const next = radioPosition(timeline, segment.endFrame / RADIO_SAMPLE_RATE);
        expect(next.segment.slug).not.toBe(segment.slug);
        expect(next.repetition).toBe(1);
        expect(next.activeStep).toBe(0);
        if (repetitions > 1) expect(next.transitionTracks).toBeNull();
      }
      const whistles = buildRadioHits(timeline, rhythms).filter((hit) => hit.sample === "Whistle.X");
      expect(whistles).toEqual(timeline.segments.flatMap((segment) =>
        [0, 8, 9, 11, 12, 14].map((step) => ({
          frame: segment.endFrame - cycleFrames + Math.round(step * cycleFrames / 16),
          sample: "Whistle.X",
        })),
      ));
    }
  }
});

test("solo and held rhythms have no exit cues; other rhythms and sequences keep their notes", () => {
  for (const rhythm of rhythms) {
    for (const repetitions of [1, 8]) {
      const timeline = buildRadioTimeline([rhythm], 90, repetitions, 24);
      expect(timeline.segments.every((segment) => !segment.transitionTracks)).toBe(true);
      expect(buildRadioHits(timeline, [rhythm]).some((hit) => hit.sample === "Whistle.X")).toBe(false);
    }
  }
  const other: Rhythm = { ...rhythms[0], slug: "martelo" };
  const combo: Rhythm = { ...rhythms[0], slug: "combo_marcacao" };
  const all = [...rhythms, other, combo];
  const timeline = buildRadioTimeline(all, 90, 4, 1, () => 0.99);
  expect(timeline.segments.map((segment) => Boolean(segment.transitionTracks))).toEqual([true, true, false, false]);
  expect(timeline.segments.at(-1)?.repetitions).toBe(1);

  const gongue = { name: "Gongue", steps: ["X", ...Array<string>(15).fill(".")] };
  const multi = { ...rhythms[0], tracks: [...rhythms[0].tracks, gongue] };
  const multiTimeline = buildRadioTimeline([multi, other], 90, 4, 1, () => 0.99);
  expect(multiTimeline.segments[0].transitionTracks?.find((track) => track.name === "Gongue")).toEqual(gongue);
});

async function openMix(page: Page, slugs = ["marcacao", "imale"]) {
  await page.addInitScript((selected) => {
    localStorage.setItem("baque-facil-language", "en-CA");
    localStorage.setItem("baque-facil-radio-v1", JSON.stringify({
      slugs: selected, tempo: 90, repetitions: 4, minutes: 2,
    }));
  }, slugs);
  await page.goto("/radio/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  return page.locator("audio[data-radio-player]");
}

test("the grid follows exit cues through seeking, language changes, holds, skips, and file wrap", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const audio = await openMix(page);
  const source = await audio.getAttribute("src");
  const firstTitle = await page.locator(".radio-now h2").textContent();
  const grid = page.locator(".radio-pattern");
  const alfaia = grid.locator(".grid-row").filter({ has: page.locator(".track-name", { hasText: /^Alfaia$/ }) }).locator(".step-cell");
  const whistle = grid.locator(".grid-row").filter({ has: page.locator(".track-name", { hasText: /^(Whistle|Apito)$/ }) }).locator(".step-cell");
  const seek = async (seconds: number) => {
    await audio.evaluate((element: HTMLAudioElement, value) => { element.currentTime = value; }, seconds);
  };

  await seek(7.9);
  await expect(grid.getByText("Transition", { exact: true })).toHaveCount(0);
  await expect(whistle).toHaveCount(0);
  await seek(8); // Fourth/final bar, at 90 BPM.
  await expect(grid.getByText("Transition", { exact: true })).toBeVisible();
  await expect(alfaia).toHaveText(alfaiaTransition);
  await expect(whistle).toHaveText(whistleTransition);
  await expect(page.locator(".radio-now h2")).toHaveText(firstTitle!);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("radio-transition.png"), fullPage: true });

  await page.locator(".language-bar").getByRole("button", { name: "Português (Brasil)" }).click();
  await expect(grid.getByText("Transição", { exact: true })).toBeVisible();
  await expect(grid.getByText("Apito", { exact: true })).toBeVisible();
  await expect(alfaia).toHaveText(alfaiaTransition.map((symbol) => symbol === "R" ? "D" : symbol === "L" ? "E" : symbol));
  await expect(whistle).toHaveText(whistleTransition);
  await expect(audio).toHaveAttribute("src", source!);
  await page.locator(".language-bar").getByRole("button", { name: "English (Canada)" }).click();

  await page.getByRole("button", { name: "Stay on this rhythm", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to mix", exact: true })).toBeVisible();
  await expect(grid.getByText("Transition", { exact: true })).toHaveCount(0);
  await expect(whistle).toHaveCount(0);
  await expect(alfaia).not.toHaveText(alfaiaTransition);
  await page.getByRole("button", { name: "Back to mix", exact: true }).click();
  await expect(audio).toHaveAttribute("src", source!);
  await expect(page.locator(".radio-now h2")).not.toHaveText(firstTitle!);
  await expect(grid.getByText("Transition", { exact: true })).toHaveCount(0);

  await seek(8);
  await expect(grid.getByText("Transition", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(grid.getByText("Transition", { exact: true })).toHaveCount(0);
  await expect(whistle).toHaveCount(0);
  await audio.evaluate((element: HTMLAudioElement) => { element.currentTime = element.duration - 0.2; });
  await expect(grid.getByText("Transition", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeLessThan(2);
  await expect(grid.getByText("Transition", { exact: true })).toHaveCount(0);
  await expect(page.locator(".radio-now h2")).toHaveText(firstTitle!);
  await expect(audio).toHaveAttribute("src", source!);
  expect(errors).toEqual([]);
});

test("the generated MP3 contains whistle bursts only in the final bar", async ({ page }) => {
  test.setTimeout(60_000);
  const audio = await openMix(page);
  const energies = await audio.evaluate(async (element: HTMLAudioElement) => {
    const context = new OfflineAudioContext(1, 1, 44_100);
    const buffer = await context.decodeAudioData(await (await fetch(element.src)).arrayBuffer());
    const pcm = buffer.getChannelData(0);
    // Measure the whistle's fundamental after each sixteenth-note attack.
    // The alfaia samples have negligible energy at this frequency.
    return Array.from({ length: 8 * 16 }, (_, step) => {
      const start = Math.round((step / 6 + 0.012) * buffer.sampleRate);
      const count = Math.round(0.045 * buffer.sampleRate);
      let real = 0;
      let imaginary = 0;
      for (let offset = 0; offset < count; offset += 1) {
        const phase = 2 * Math.PI * 2930 * offset / buffer.sampleRate;
        real += pcm[start + offset] * Math.cos(phase);
        imaginary += pcm[start + offset] * Math.sin(phase);
      }
      return 2 * Math.hypot(real, imaginary) / count;
    });
  });
  const cueSteps = [0, 8, 9, 11, 12, 14];
  const expectedSteps = [3, 7].flatMap((bar) => cueSteps.map((step) => bar * 16 + step));
  expect(energies.flatMap((energy, step) => energy > 0.025 ? [step] : [])).toEqual(expectedSteps);
});

test("a solo mix never loads or displays the whistle", async ({ page }) => {
  const whistleRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/samples/whistle/")) whistleRequests.push(request.url());
  });
  const audio = await openMix(page, ["imale"]);
  await audio.evaluate((element: HTMLAudioElement) => { element.currentTime = 8; });
  await expect(page.locator(".radio-pattern-heading")).toContainText("Repetition 4 of 4");
  await expect(page.getByText("Transition", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Whistle", { exact: true })).toHaveCount(0);
  expect(whistleRequests).toEqual([]);
});

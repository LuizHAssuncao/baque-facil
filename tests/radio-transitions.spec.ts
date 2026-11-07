import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { extractRhythmBlock } from "../src/lib/extractRhythmBlock";
import { parseRhythm } from "../src/lib/parseRhythm";
import { buildRadioHits } from "../src/lib/radio/mixer";
import { buildRadioTimeline, radioPosition, RADIO_SAMPLE_RATE } from "../src/lib/radio/timeline";
import type { Rhythm } from "../src/lib/rhythmTypes";

function libraryRhythm(filename: string): Rhythm {
  const markdown = readFileSync(new URL(`../src/content/rhythms/${filename}.md`, import.meta.url), "utf8");
  return {
    title: markdown.match(/^title: "(.+)"/m)![1],
    slug: markdown.match(/^slug: "(.+)"/m)![1],
    tempo: 90,
    subdivision: 16,
    tracks: parseRhythm(extractRhythmBlock(markdown)!),
  };
}

const rhythms = ["marcacao", "imale"].map(libraryRhythm);
const regularRhythms = ["marcacao", "imale", "martelo", "parada", "trovao", "arrasto", "afoxe"].map(libraryRhythm);
const sequences = ["combo_entrada", "combo_parada_arrasto", "combo_three_crossed_break", "flying_four", "martelo_break"].map(libraryRhythm);

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
  for (const rhythm of [...regularRhythms, ...sequences]) {
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
  expect(timeline.segments.map((segment) => Boolean(segment.transitionTracks))).toEqual([true, true, true, false]);
  expect(timeline.segments.at(-1)?.repetitions).toBe(1);

  const gongue = { name: "Gongue", steps: ["X", ...Array<string>(15).fill(".")] };
  const multi = { ...rhythms[0], tracks: [...rhythms[0].tracks, gongue] };
  const multiTimeline = buildRadioTimeline([multi, other], 90, 4, 1, () => 0.99);
  expect(multiTimeline.segments[0].transitionTracks?.find((track) => track.name === "Gongue")).toEqual(gongue);
});

test("every regular library rhythm gets the whistle while only marcação and imalê change alfaia", () => {
  const original = structuredClone(regularRhythms);
  const timeline = buildRadioTimeline(regularRhythms, 90, 4, 1, () => 0.99);
  const hits = buildRadioHits(timeline, regularRhythms);
  expect(timeline.totalFrames).toBe(regularRhythms.reduce((total, rhythm) =>
    total + rhythm.tracks[0].steps.length * 4 * RADIO_SAMPLE_RATE / 6, 0,
  ));
  for (const segment of timeline.segments) {
    const rhythm = regularRhythms.find((entry) => entry.slug === segment.slug)!;
    expect(segment.transitionTracks).toBeDefined();
    const expectedAlfaia = rhythm.slug === "marcacao" || rhythm.slug === "imale"
      ? [{ name: "Alfaia", steps: alfaiaTransition }]
      : rhythm.tracks;
    expect(segment.transitionTracks!.filter((track) => track.name !== "Whistle")).toEqual(expectedAlfaia);
    expect(hits.filter((hit) => hit.sample === "Whistle.X" && hit.frame >= segment.startFrame && hit.frame < segment.endFrame))
      .toEqual([0, 8, 9, 11, 12, 14].map((step) => ({
        sample: "Whistle.X", frame: segment.transitionStartFrame! + step * RADIO_SAMPLE_RATE / 6,
      })));
  }
  expect(regularRhythms).toEqual(original);
});

test("sequence exclusions depend on the outgoing item, including the file wrap", () => {
  const regular = libraryRhythm("martelo");
  for (const sequence of [...sequences, { ...regular, slug: "named-sequence", title: "Combo test" }]) {
    for (const entries of [[regular, sequence], [sequence, regular]]) {
      const original = structuredClone(entries);
      const timeline = buildRadioTimeline(entries, 90, 4, 1, () => 0.99);
      const hits = buildRadioHits(timeline, entries);
      for (const segment of timeline.segments) {
        const isRegular = segment.slug === regular.slug;
        expect(Boolean(segment.transitionTracks)).toBe(isRegular);
        expect(segment.repetitions).toBe(isRegular ? 4 : 1);
        expect(hits.filter((hit) => hit.sample === "Whistle.X" && hit.frame >= segment.startFrame && hit.frame < segment.endFrame))
          .toHaveLength(isRegular ? 6 : 0);
      }
      expect(entries).toEqual(original);
    }
  }
  const sequenceTimeline = buildRadioTimeline(sequences, 90, 4, 1, () => 0.99);
  expect(sequenceTimeline.segments.every((segment) => !segment.transitionTracks)).toBe(true);
  expect(buildRadioHits(sequenceTimeline, sequences).some((hit) => hit.sample === "Whistle.X")).toBe(false);
});

test("Parada's cue starts in the last bar, not at the start of its final two-bar repetition", () => {
  const parada = libraryRhythm("parada");
  for (const tempo of [30, 90, 130]) {
    for (const repetitions of [1, 4, 8, 16]) {
      const entries = [parada, libraryRhythm("martelo")];
      const timeline = buildRadioTimeline(entries, tempo, repetitions, 1, () => 0.99);
      const segment = timeline.segments[0];
      const lastCycle = segment.endFrame - segment.cycleFrames;
      const cueStart = lastCycle + Math.round(segment.cycleFrames / 2);
      expect(segment.transitionStartFrame).toBe(cueStart);
      expect(segment.transitionTracks).toEqual([
        parada.tracks[0],
        { name: "Whistle", steps: [...Array<string>(16).fill("."), ...whistleTransition] },
      ]);
      expect(radioPosition(timeline, lastCycle / RADIO_SAMPLE_RATE).transitionTracks).toBeNull();
      expect(radioPosition(timeline, (cueStart - 1) / RADIO_SAMPLE_RATE).transitionTracks).toBeNull();
      expect(radioPosition(timeline, cueStart / RADIO_SAMPLE_RATE)).toMatchObject({
        activeStep: 16, repetition: repetitions, transitionTracks: segment.transitionTracks,
      });
      expect(buildRadioHits(timeline, entries).filter((hit) => hit.sample === "Whistle.X" && hit.frame < segment.endFrame))
        .toEqual([16, 24, 25, 27, 28, 30].map((step) => ({
          sample: "Whistle.X", frame: lastCycle + Math.round(step * segment.cycleFrames / 32),
        })));
    }
  }
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

async function whistleLevels(page: Page, seconds: number[]) {
  return page.locator("audio[data-radio-player]").evaluate(async (element: HTMLAudioElement, times) => {
    const decoder = new OfflineAudioContext(1, 1, 44_100);
    const buffer = await decoder.decodeAudioData(await (await fetch(element.src)).arrayBuffer());
    const context = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
    const source = context.createBufferSource();
    source.buffer = buffer;
    // The library recording's whistle is around 2.5 kHz, above the alfaia body.
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 2500;
    filter.Q.value = 5;
    source.connect(filter).connect(context.destination);
    source.start();
    const pcm = (await context.startRendering()).getChannelData(0);
    return times.map((time) => {
      const start = Math.round(time * buffer.sampleRate);
      const count = Math.round(0.08 * buffer.sampleRate);
      let energy = 0;
      for (let frame = start; frame < start + count; frame += 1) energy += pcm[frame] ** 2;
      return Math.sqrt(energy / count);
    });
  }, seconds);
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
  await openMix(page);
  // Probe beat three, after any decay from the preceding bar has finished.
  const levels = await whistleLevels(page, Array.from({ length: 8 }, (_, bar) => (bar * 16 + 8) / 6 + 0.12));
  const normal = levels.filter((_, bar) => bar !== 3 && bar !== 7);
  for (const bar of [3, 7]) {
    expect(levels[bar]).toBeGreaterThan(0.01);
    expect(levels[bar]).toBeGreaterThan(Math.max(...normal) * 5);
  }
});

for (const slug of ["martelo", "parada"]) {
  test(`${slug} keeps its notes under the whistle, then the sequence exits without a cue`, async ({ page }) => {
    test.setTimeout(60_000);
    const rhythm = libraryRhythm(slug);
    const sequence = libraryRhythm("combo_entrada");
    const audio = await openMix(page, [slug, sequence.slug]);
    const title = page.locator(".radio-now h2");
    if (await title.textContent() !== rhythm.title) {
      await page.getByRole("button", { name: "Skip", exact: true }).click();
    } else {
      await audio.evaluate((element: HTMLAudioElement) => { element.currentTime = 0; });
    }
    await expect(title).toHaveText(rhythm.title);
    const start = await audio.evaluate((element: HTMLAudioElement) => element.currentTime);
    const bar = 4 * 60 / 90;
    const cueStart = start + rhythm.tracks[0].steps.length / 6 * 4 - bar;
    const grid = page.locator(".radio-pattern");
    const alfaia = grid.locator(".grid-row").filter({ has: page.locator(".track-name", { hasText: /^Alfaia$/ }) }).locator(".step-cell");
    const whistle = grid.locator(".grid-row").filter({ has: page.locator(".track-name", { hasText: /^Whistle$/ }) }).locator(".step-cell");
    await audio.evaluate((element: HTMLAudioElement, time) => { element.currentTime = time; }, cueStart - 0.02);
    await expect(grid.getByText("Transition", { exact: true })).toHaveCount(0);
    await expect(whistle).toHaveCount(0);
    await audio.evaluate((element: HTMLAudioElement, time) => { element.currentTime = time; }, cueStart + 0.02);
    await expect(grid.getByText("Transition", { exact: true })).toBeVisible();
    await expect(alfaia).toHaveText(rhythm.tracks[0].steps);
    await expect(whistle).toHaveText([...Array<string>(rhythm.tracks[0].steps.length - 16).fill("."), ...whistleTransition]);
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(title).toHaveText(sequence.title);
    const sequenceStart = await audio.evaluate((element: HTMLAudioElement) => element.currentTime);
    const sequenceCueStart = sequenceStart + sequence.tracks[0].steps.length / 6 - bar;
    await audio.evaluate((element: HTMLAudioElement, time) => { element.currentTime = time; }, sequenceCueStart + 0.02);
    await expect(grid.getByText("Transition", { exact: true })).toHaveCount(0);
    await expect(whistle).toHaveCount(0);
    await expect(alfaia).toHaveText(sequence.tracks[0].steps);
    const levels = await whistleLevels(page, [cueStart - bar + bar / 2 + 0.12, cueStart + bar / 2 + 0.12, sequenceCueStart + bar / 2 + 0.12]);
    expect(levels[1]).toBeGreaterThan(0.01);
    expect(levels[1]).toBeGreaterThan(Math.max(levels[0], levels[2]) * 5);
  });
}

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

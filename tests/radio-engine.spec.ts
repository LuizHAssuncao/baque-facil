import { expect, test } from "@playwright/test";
import {
  buildRadioTimeline,
  normalizeRadioSettings,
  radioPosition,
  RADIO_CHUNK_FRAMES,
  RADIO_SAMPLE_RATE,
  shuffleBag,
} from "../src/lib/radio/timeline";
import { buildRadioHits, RadioMixer } from "../src/lib/radio/mixer";
import type { Rhythm } from "../src/lib/rhythmTypes";

// Existing radio behavior tests run as a returning English visitor.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("baque-facil-language", "en-CA"));
});

const makeRhythm = (slug: string, steps = 16): Rhythm => ({
  title: slug,
  slug,
  tempo: 90,
  subdivision: 16,
  tracks: [
    {
      name: "Test",
      steps: Array.from({ length: steps }, (_, index) =>
        index === 0 ? "X" : ".",
      ),
    },
  ],
});

function random(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

test("radio visits complete shuffle bags without adjacent repeats, including the file wrap", () => {
  const rhythms = [makeRhythm("a"), makeRhythm("b", 32), makeRhythm("c")];
  for (let seed = 0; seed < 30; seed += 1) {
    const timeline = buildRadioTimeline(
      rhythms,
      90,
      8,
      1200,
      random(seed),
      "a",
    );
    const slugs = timeline.segments.map((segment) => segment.slug);
    expect(slugs[0]).not.toBe("a");
    expect(slugs.at(-1)).not.toBe(slugs[0]);
    for (let index = 0; index < slugs.length; index += 3) {
      expect([...slugs.slice(index, index + 3)].sort()).toEqual([
        "a",
        "b",
        "c",
      ]);
    }
    for (let index = 1; index < slugs.length; index += 1)
      expect(slugs[index]).not.toBe(slugs[index - 1]);
    const roundDuration = (((16 + 32 + 16) * (60 / 90)) / 4) * 8;
    expect(
      Math.abs(timeline.totalFrames / RADIO_SAMPLE_RATE - 1200),
    ).toBeLessThanOrEqual(roundDuration / 2 + 0.001);
  }
});

test("radio handles a single rhythm, two rhythms, combos, and invalid settings", () => {
  expect(shuffleBag([], "x")).toEqual([]);
  expect(shuffleBag(["a"], "a")).toEqual(["a"]);
  for (let seed = 0; seed < 10; seed += 1) {
    const timeline = buildRadioTimeline(
      [makeRhythm("a"), makeRhythm("b")],
      130,
      4,
      120,
      random(seed),
    );
    expect(timeline.segments[0].slug).not.toBe(timeline.segments.at(-1)?.slug);
  }
  const solo = buildRadioTimeline([makeRhythm("a")], 30, 16, 1);
  expect(solo.segments).toHaveLength(1);
  expect(solo.totalFrames / RADIO_SAMPLE_RATE).toBe(128);
  const combo = buildRadioTimeline([makeRhythm("combo_long", 144)], 90, 16, 1);
  expect(combo.segments[0].repetitions).toBe(1);
  expect(() => buildRadioTimeline([], 90, 8, 120)).toThrow("Select");
  expect(() =>
    buildRadioTimeline([makeRhythm("a")], 90, 8, Infinity),
  ).toThrow();
  const entries = [
    { rhythm: makeRhythm("a"), combo: false, difficulty: "beginner" },
  ];
  expect(
    normalizeRadioSettings(
      {
        slugs: ["a", "a", "missing", 42],
        tempo: 900,
        repetitions: 0,
        minutes: 999,
      },
      entries,
    ),
  ).toEqual({ slugs: ["a"], tempo: 130, repetitions: 8, minutes: 20 });
});

test("radio positions use the media clock across different pattern lengths and repeats", () => {
  const timeline = buildRadioTimeline(
    [makeRhythm("a"), makeRhythm("b", 32)],
    120,
    4,
    1,
    () => 0.9,
  );
  const second = timeline.segments[1];
  expect(radioPosition(timeline, 0).activeStep).toBe(0);
  expect(radioPosition(timeline, 2.125).repetition).toBe(2);
  expect(radioPosition(timeline, 2.125).activeStep).toBe(1);
  expect(
    radioPosition(timeline, second.startFrame / RADIO_SAMPLE_RATE).segment.slug,
  ).toBe(second.slug);
  const fractional = buildRadioTimeline(
    [makeRhythm("a"), makeRhythm("b")],
    90,
    4,
    120,
    () => 0.9,
  );
  const boundary = fractional.segments[1].startFrame / RADIO_SAMPLE_RATE;
  expect(
    radioPosition(fractional, Math.floor(boundary * 1e6) / 1e6).index,
  ).toBe(1);
  expect(
    radioPosition(timeline, timeline.totalFrames / RADIO_SAMPLE_RATE).segment
      .slug,
  ).toBe(timeline.segments[0].slug);
});

test("mixer carries tails across chunk boundaries and wraps the recording without clipping a hit", () => {
  const timeline = {
    tempo: 90,
    totalFrames: 8,
    segments: [
      {
        slug: "a",
        startFrame: 0,
        endFrame: 8,
        cycleFrames: 8,
        stepCount: 2,
        repetitions: 1,
      },
    ],
  };
  const rhythm = {
    ...makeRhythm("a", 2),
    tracks: [{ name: "Test", steps: [".", "X"] }],
  };
  const samples = {
    "Test.X": {
      left: new Float32Array(6).fill(0.25),
      right: new Float32Array(6).fill(0.5),
    },
  };
  const hits = buildRadioHits(timeline, [rhythm]);
  expect(hits).toEqual([{ frame: 4, sample: "Test.X" }]);
  const mixer = new RadioMixer(hits, samples, 8);
  const first = mixer.chunk(0, 3);
  const second = mixer.chunk(3, 5);
  expect([...first.slice(0, 3), ...second.slice(0, 5)]).toEqual([
    0.25, 0.25, 0, 0, 0.25, 0.25, 0.25, 0.25,
  ]);
  expect([...first.slice(3), ...second.slice(5)]).toEqual([
    0.5, 0.5, 0, 0, 0.5, 0.5, 0.5, 0.5,
  ]);
  expect(new RadioMixer(hits, samples, 8).chunk(0, 8, 0.5)[0]).toBe(0.125);
  expect(RADIO_CHUNK_FRAMES * 2 * Float32Array.BYTES_PER_ELEMENT).toBeLessThan(
    1_000_000,
  );
});

test("MP3 encoding preserves duration and attacks with gapless metadata", async ({
  page,
}) => {
  await page.goto("/radio/");
  const result = await page.evaluate(async () => {
    const timelinePath = "/src/lib/radio/timeline.ts";
    const encoderPath = "/src/lib/radio/encodeMix.ts";
    const { buildRadioTimeline, RADIO_SAMPLE_RATE } = await import(
      /* @vite-ignore */ timelinePath
    );
    const { encodeMix } = await import(/* @vite-ignore */ encoderPath);
    const sampleRate = RADIO_SAMPLE_RATE;
    const rhythm = {
      title: "Test",
      slug: "test",
      tempo: 120,
      subdivision: 16,
      tracks: [{ name: "Test", steps: ["X", ...Array(15).fill(".")] }],
    };
    const timeline = buildRadioTimeline([rhythm], 120, 1, 4);
    const pcm = Float32Array.from(
      { length: 6000 },
      (_, index) =>
        Math.sin((index * 2 * Math.PI * 220) / sampleRate) *
        Math.exp(-index / 1200) *
        0.5,
    );
    const progress: number[] = [];
    const blob = await encodeMix(
      {
        timeline,
        rhythms: [rhythm],
        samples: { "Test.X": { left: pcm, right: pcm } },
      },
      (value: number) => progress.push(value),
      new AbortController().signal,
    );
    const buffer = await new OfflineAudioContext(
      2,
      1,
      sampleRate,
    ).decodeAudioData(await blob.arrayBuffer());
    const data = buffer.getChannelData(0);
    const onset =
      data.findIndex((value) => Math.abs(value) > 0.05) / sampleRate;
    return {
      frames: buffer.length,
      expectedFrames: timeline.totalFrames,
      duration: buffer.duration,
      bytes: blob.size,
      type: blob.type,
      onset,
      progress: progress.at(-1),
      peak: data.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0),
    };
  });
  expect(result.frames).toBe(result.expectedFrames);
  expect(result.duration).toBe(4);
  expect(result.bytes).toBeGreaterThan(60_000);
  expect(result.bytes).toBeLessThan(70_000);
  expect(result.type).toBe("audio/mpeg");
  expect(result.onset).toBeLessThan(0.01);
  expect(result.peak).toBeGreaterThan(0.3);
  expect(result.peak).toBeLessThan(1);
  expect(result.progress).toBe(1);
});

test("MP3 encoding releases its worker when cancelled during encoding", async ({
  page,
}) => {
  await page.goto("/radio/");
  const result = await page.evaluate(async () => {
    const encoderPath = "/src/lib/radio/encodeMix.ts";
    const timelinePath = "/src/lib/radio/timeline.ts";
    const { encodeMix } = await import(/* @vite-ignore */ encoderPath);
    const { buildRadioTimeline } = await import(
      /* @vite-ignore */ timelinePath
    );
    const rhythm = {
      title: "Test",
      slug: "test",
      tempo: 120,
      subdivision: 16,
      tracks: [{ name: "Test", steps: ["X", ...Array(15).fill(".")] }],
    };
    const pcm = new Float32Array(1000).fill(0.2);
    const controller = new AbortController();
    const terminate = Worker.prototype.terminate;
    let terminated = 0;
    Worker.prototype.terminate = function () {
      terminated += 1;
      terminate.call(this);
    };
    try {
      await encodeMix(
        {
          timeline: buildRadioTimeline([rhythm], 120, 1, 30),
          rhythms: [rhythm],
          samples: { "Test.X": { left: pcm, right: pcm } },
        },
        (progress: number) => {
          if (progress > 0.15) controller.abort();
        },
        controller.signal,
      );
      return { cancelled: false, terminated };
    } catch (error) {
      return {
        cancelled: error instanceof DOMException && error.name === "AbortError",
        terminated,
      };
    } finally {
      Worker.prototype.terminate = terminate;
    }
  });
  expect(result.cancelled).toBe(true);
  expect(result.terminated).toBe(1);
});

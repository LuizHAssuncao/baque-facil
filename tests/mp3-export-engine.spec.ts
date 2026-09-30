import { expect, test } from "@playwright/test";
import { exportFramesWithDecay, MAX_EXPORT_FRAMES, planMp3Export, type Mp3ExportRequest } from "../src/lib/audio/exportMp3";
import { PcmMixer } from "../src/lib/audio/pcmMixer";
import { MP3_SAMPLE_RATE } from "../src/lib/audio/mp3Constants";
import { mp3Filename } from "../src/lib/audio/downloadMp3";

function request(): Mp3ExportRequest {
  return {
    rhythm: { title: "Test", slug: "test", tempo: 120, subdivision: 16, tracks: [
      { name: "Alfaia", steps: ["R", ".", ".", "L"] },
      { name: "Caixa", steps: ["X", ".", ".", "."] },
    ] },
    tempo: 120, mutedTracks: ["Caixa"], repetitions: 4,
    samples: { "Alfaia.R": "/r.wav", "Alfaia.L": "/l.wav", "Caixa.X": "/x.wav" },
  };
}

test("pattern exports use complete sequences, integer timing, and audible tracks", () => {
  for (const subdivision of [8, 16, 32] as const) {
    const input = request();
    input.rhythm.subdivision = subdivision;
    const plan = planMp3Export(input);
    const cycle = Math.round(0.5 * (4 / subdivision) * 4 * MP3_SAMPLE_RATE);
    expect(plan.cycleFrames).toBe(cycle);
    expect(plan.totalFrames).toBe(cycle * 4);
    expect(plan.hits).toEqual(Array.from({ length: 4 }, (_, repeat) => [
      { frame: repeat * cycle, sample: "Alfaia.R" },
      { frame: repeat * cycle + Math.round(3 * cycle / 4), sample: "Alfaia.L" },
    ]).flat());
  }
});

test("pattern export validation rejects silent, invalid, missing-sample and oversized requests", () => {
  const input = request();
  expect(() => planMp3Export({ ...input, mutedTracks: ["Alfaia", "Caixa"] })).toThrow("unmute");
  expect(() => planMp3Export({ ...input, tempo: NaN })).toThrow("Tempo");
  expect(() => planMp3Export({ ...input, repetitions: 3 })).toThrow("repetitions");
  expect(() => planMp3Export({ ...input, samples: {} })).toThrow("Unknown symbol");
  input.rhythm.tracks[0].steps.pop();
  expect(() => planMp3Export(input)).toThrow("same number");
  input.rhythm.tracks = [];
  expect(() => planMp3Export(input)).toThrow("at least one track");
  input.rhythm.tracks = [{ name: "Alfaia", steps: Array(400).fill("R") }];
  expect(() => planMp3Export({ ...input, tempo: 30 })).toThrow("too long");
  input.rhythm.tracks[0].steps = Array(256).fill("R");
  expect(() => planMp3Export({ ...input, tempo: 30, repetitions: 16 })).toThrow("20 minutes");
  input.rhythm.tracks[0].steps = ["-", "."];
  expect(() => planMp3Export(input)).toThrow("Add a note");
});

test("finite mixing starts cleanly, preserves decay across chunks, and caps final duration", () => {
  const hits = [{ frame: 4, sample: "hit" }];
  const samples = { hit: { left: new Float32Array(6).fill(0.25), right: new Float32Array(6).fill(0.5) } };
  const frames = exportFramesWithDecay(hits, samples, 8);
  expect(frames).toBe(10);
  const mixer = new PcmMixer(hits, samples, frames, "finite");
  const first = mixer.chunk(0, 5);
  const last = mixer.chunk(5, 5);
  expect([...first.slice(0, 5), ...last.slice(0, 5)]).toEqual([0, 0, 0, 0, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25]);
  expect([...first.slice(5), ...last.slice(5)]).toEqual([0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
  expect(new PcmMixer(hits, samples, 8, "wrapped").chunk(0, 8)[0]).toBe(0.25);
  expect(() => exportFramesWithDecay([{ frame: MAX_EXPORT_FRAMES - 1, sample: "hit" }], samples, MAX_EXPORT_FRAMES)).toThrow("20 minutes");
  expect(mp3Filename(" ../Marcação <test> ", "90bpm-8x")).toBe("marcacao-test-90bpm-8x.mp3");
  expect(mp3Filename("...", "90bpm-1x")).toBe("baque-facil-composition-90bpm-1x.mp3");
});

test("finite MP3 round trip preserves leading rests, natural decay and bounded gain", async ({ page }) => {
  await page.goto("/radio/");
  const result = await page.evaluate(async () => {
    const encoderPath = "/src/lib/audio/encodeMp3.ts";
    const { encodeMp3 } = await import(/* @vite-ignore */ encoderPath);
    const rate = 44100;
    const pcm = Float32Array.from({ length: rate }, (_, index) => Math.sin(index * 2 * Math.PI * 220 / rate) * 1.5);
    const frames = 1.5 * rate;
    const blob = await encodeMp3({
      hits: [{ frame: rate / 2, sample: "hit" }], samples: { hit: { left: pcm, right: pcm } }, totalFrames: frames, boundary: "finite",
    }, () => {}, new AbortController().signal);
    const decoded = await new OfflineAudioContext(2, 1, rate).decodeAudioData(await blob.arrayBuffer());
    const data = decoded.getChannelData(0);
    const peak = (values: Float32Array) => values.reduce((value, next) => Math.max(value, Math.abs(next)), 0);
    return { frames: decoded.length, expectedFrames: frames, type: blob.type, start: peak(data.slice(0, rate / 4)), tail: peak(data.slice(-rate / 4)), peak: peak(data) };
  });
  expect(result.type).toBe("audio/mpeg");
  expect(result.frames).toBe(result.expectedFrames);
  expect(result.start).toBeLessThan(0.001);
  expect(result.tail).toBeGreaterThan(0.5);
  expect(result.peak).toBeLessThan(1);
});

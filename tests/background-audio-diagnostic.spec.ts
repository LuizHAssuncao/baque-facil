import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    diagnosticCapture: {
      contexts: AudioContext[];
      sources: AudioBufferSourceNode[];
      resumeCalls: number;
      sessionAtCreation: (string | undefined)[];
    };
  }
}

test.beforeEach(async ({ page }) => {
  // Observe real browser audio nodes without adding test hooks to the page itself.
  await page.addInitScript(() => {
    const NativeAudioContext = window.AudioContext;
    const capture: Window["diagnosticCapture"] = {
      contexts: [], sources: [], resumeCalls: 0, sessionAtCreation: [],
    };
    window.diagnosticCapture = capture;
    window.AudioContext = class extends NativeAudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        capture.contexts.push(this);
        capture.sessionAtCreation.push(
          (navigator as Navigator & { audioSession?: { type: string } }).audioSession?.type,
        );
      }
      createBufferSource(): AudioBufferSourceNode {
        const source = super.createBufferSource();
        capture.sources.push(source);
        return source;
      }
      resume(): Promise<void> {
        capture.resumeCalls += 1;
        return super.resume();
      }
    };
  });
});

test("beat loops on one native source, changes tempo, stops, and starts again", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/diagnostics/background-audio/");
  expect(await page.evaluate(() => window.diagnosticCapture.contexts.length)).toBe(0);
  await expect(page.locator("audio")).toHaveCount(0);
  await page.getByRole("button", { name: "Start beat" }).click();
  await expect(page.getByRole("status", { name: "Test playback status" })).toContainText("Playing at 120 BPM");
  await expect.poll(() => page.evaluate(() => window.diagnosticCapture.contexts[0].currentTime)).toBeGreaterThan(2.1);
  expect(await page.evaluate(() => {
    const capture = window.diagnosticCapture;
    return { sources: capture.sources.length, loop: capture.sources[0].loop, duration: capture.sources[0].buffer?.duration };
  })).toEqual({ sources: 1, loop: true, duration: 2 });
  await page.getByRole("slider", { name: "Tempo" }).fill("90");
  await expect(page.getByRole("status", { name: "Test playback status" })).toContainText("Playing at 90 BPM");
  expect(await page.evaluate(() => ({
    rate: window.diagnosticCapture.sources[0].playbackRate.value,
    sources: window.diagnosticCapture.sources.length,
  }))).toEqual({ rate: 0.75, sources: 1 });
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.diagnosticCapture.contexts[0].state)).toBe("closed");
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Start beat" }).click();
  await expect(page.getByRole("status", { name: "Test playback status" })).toContainText("Playing at 90 BPM");
  expect(await page.evaluate(() => window.diagnosticCapture.sources.length)).toBe(2);
  expect(errors).toEqual([]);
});

test("playback session precedes the context and a simulated interruption requires a tap", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "audioSession", { configurable: true, value: { type: "auto" } });
  });
  await page.goto("/diagnostics/background-audio/");
  await page.getByRole("button", { name: "Start beat" }).click();
  await expect(page.locator("[data-session]")).toHaveText("playback (accepted)");
  expect(await page.evaluate(() => window.diagnosticCapture.sessionAtCreation)).toEqual(["playback"]);
  await page.evaluate(async () => {
    // This exercises reporting and recovery, not actual iOS background behavior.
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await window.diagnosticCapture.contexts[0].suspend();
    delete (document as unknown as { hidden?: boolean }).hidden;
    delete (document as unknown as { visibilityState?: string }).visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByRole("status", { name: "Test playback status" })).toContainText("suspended");
  await expect(page.locator("[data-background]")).toContainText("audio clock advanced");
  expect(await page.evaluate(() => window.diagnosticCapture.resumeCalls)).toBe(1);
  await page.getByRole("button", { name: "Resume beat" }).click();
  await expect(page.getByRole("status", { name: "Test playback status" })).toContainText("Playing");
  expect(await page.evaluate(() => window.diagnosticCapture.sources.length)).toBe(1);
  await page.getByLabel("What did you hear while away?").selectOption("Sound stopped");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy report" }).click();
  await expect(page.locator("[data-copy-status]")).toContainText("Report copied");
  const report = await page.evaluate(() => navigator.clipboard.readText());
  expect(report).toContain("Listening result: Sound stopped");
  expect(report).toContain("AudioContext state changed to suspended");
  expect(report).toContain("Visibility changed to hidden");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator("[data-session]")).toHaveText("auto (inactive)");
  await page.reload();
  await expect(page.getByRole("button", { name: "Start beat" })).toBeEnabled();
  expect(await page.evaluate(() => window.diagnosticCapture.contexts.length)).toBe(0);
  expect(await page.getByLabel("Diagnostic report", { exact: true }).inputValue()).toContain("Listening result: Sound stopped");
});

test("unsupported playback-session API is reported without blocking the beat", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "audioSession", { configurable: true, value: undefined });
  });
  await page.goto("/diagnostics/background-audio/");
  await expect(page.locator("[data-session]")).toHaveText("Audio Session API unavailable");
  await page.getByRole("button", { name: "Start beat" }).click();
  await expect(page.getByRole("status", { name: "Test playback status" })).toContainText("Playing");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

test("rendered clicks remain equally spaced across the short buffer boundary", async ({ page }) => {
  await page.goto("/diagnostics/background-audio/");
  await page.getByRole("button", { name: "Start beat" }).click();
  const onsetTimes = await page.evaluate(async () => {
    const buffer = window.diagnosticCapture.sources[0].buffer!;
    const renderer = new OfflineAudioContext(1, buffer.sampleRate * 5, buffer.sampleRate);
    const source = renderer.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(renderer.destination);
    source.start();
    const audio = (await renderer.startRendering()).getChannelData(0);
    const onsets: number[] = [];
    let lastHit = -buffer.sampleRate;
    for (let frame = 0; frame < audio.length; frame += 1) {
      if (Math.abs(audio[frame]) > 0.01 && frame - lastHit > buffer.sampleRate * 0.1) {
        onsets.push(frame / buffer.sampleRate);
        lastHit = frame;
      }
    }
    return onsets;
  });
  expect(onsetTimes).toHaveLength(10);
  for (let beat = 0; beat < onsetTimes.length; beat += 1) {
    expect(onsetTimes[beat]).toBeCloseTo(beat * 0.5, 3);
  }
});

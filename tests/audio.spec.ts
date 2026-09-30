import { expect, test, type Page } from "@playwright/test";

// Existing interaction coverage runs with an explicitly saved language.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("baque-facil-language", "en-CA"));
});

declare global {
  interface Window {
    rhythmAudioProbe: {
      contexts: AudioContext[];
      voices: {
        source: AudioBufferSourceNode;
        gain: GainNode | null;
        when: number;
        offset: number;
        stopped: boolean;
        ended: boolean;
      }[];
      buffers: AudioBuffer[];
      resumeCalls: number;
      sessionAtCreation: (string | undefined)[];
      actions: Partial<Record<MediaSessionAction, MediaSessionActionHandler | null>>;
      holdRenders: boolean;
      heldRenders: (() => void)[];
    };
  }
}

test.beforeEach(async ({ page }) => {
  // Observe actual audio nodes, without exposing the production controller on window.
  await page.addInitScript(() => {
    const probe: Window["rhythmAudioProbe"] = {
      contexts: [], voices: [], buffers: [], resumeCalls: 0, sessionAtCreation: [],
      actions: {}, holdRenders: false, heldRenders: [],
    };
    window.rhythmAudioProbe = probe;
    Object.defineProperty(navigator, "audioSession", { configurable: true, value: { type: "auto" } });
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        probe.contexts.push(this);
        probe.sessionAtCreation.push((navigator as Navigator & { audioSession?: { type: string } }).audioSession?.type);
      }
      createBufferSource(): AudioBufferSourceNode {
        const source = super.createBufferSource();
        const voice: Window["rhythmAudioProbe"]["voices"][number] = {
          source, gain: null, when: 0, offset: 0, stopped: false, ended: false,
        };
        probe.voices.push(voice);
        const start = source.start.bind(source);
        source.start = (when = 0, offset = 0, duration?: number) => {
          voice.when = when;
          voice.offset = offset;
          if (duration === undefined) start(when, offset);
          else start(when, offset, duration);
        };
        const stop = source.stop.bind(source);
        source.stop = (when = 0) => { voice.stopped = true; stop(when); };
        source.addEventListener("ended", () => { voice.ended = true; });
        return source;
      }
      createGain(): GainNode {
        const gain = super.createGain();
        probe.voices[probe.voices.length - 1].gain = gain;
        return gain;
      }
      resume(): Promise<void> {
        probe.resumeCalls += 1;
        return super.resume();
      }
    };
    const render = OfflineAudioContext.prototype.startRendering;
    OfflineAudioContext.prototype.startRendering = async function () {
      const buffer = await render.call(this);
      if (probe.holdRenders) await new Promise<void>((resolve) => probe.heldRenders.push(resolve));
      probe.buffers.push(buffer);
      return buffer;
    };
    if ("mediaSession" in navigator) {
      const setAction = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
      navigator.mediaSession.setActionHandler = (action, handler) => {
        probe.actions[action] = handler;
        setAction(action, handler);
      };
    }
  });
});

async function openPlayer(page: Page) {
  await page.goto("/rhythms/marcacao/");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  await expect(page.getByRole("status", { name: "Playback status" })).toHaveCount(0);
  await expect(page.locator("audio")).toHaveCount(0);
}

async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((hidden) => {
    if (hidden) Object.defineProperty(document, "hidden", { configurable: true, value: true });
    else delete (document as unknown as { hidden?: boolean }).hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test("native rhythm buffer repeats without replacing sources and preserves pitch on tempo change", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openPlayer(page);
  expect(await page.evaluate(() => window.rhythmAudioProbe.contexts.length)).toBe(0);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.rhythmAudioProbe.sessionAtCreation)).toEqual(["playback"]);
  await expect.poll(() => page.evaluate(() => {
    const probe = window.rhythmAudioProbe;
    return (probe.contexts[0].currentTime - probe.voices[0].when) / probe.voices[0].source.buffer!.duration;
  }), { timeout: 10_000 }).toBeGreaterThan(2);
  expect(await page.evaluate(() => ({
    count: window.rhythmAudioProbe.voices.length,
    loop: window.rhythmAudioProbe.voices[0].source.loop,
    stopped: window.rhythmAudioProbe.voices[0].stopped,
  }))).toEqual({ count: 1, loop: true, stopped: false });
  await page.getByRole("slider", { name: "Tempo" }).fill("110");
  await expect.poll(() => page.evaluate(() => window.rhythmAudioProbe.voices.length)).toBe(2);
  const change = await page.evaluate(() => {
    const [first, second] = window.rhythmAudioProbe.voices;
    return {
      boundary: (second.when - first.when) / first.source.buffer!.duration,
      duration: second.source.buffer!.duration,
      rate: second.source.playbackRate.value,
    };
  });
  expect(change.boundary).toBeCloseTo(Math.round(change.boundary), 6);
  expect(change.duration).toBeCloseTo(4 * 60 / 110, 4);
  expect(change.rate).toBe(1);
  await expect.poll(() => page.evaluate(() => window.rhythmAudioProbe.voices[0].stopped)).toBe(true);
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.rhythmAudioProbe.voices.length)).toBe(3);
  expect(await page.evaluate(() => window.rhythmAudioProbe.voices[2].offset)).toBe(0);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.rhythmAudioProbe.contexts[0].state)).toBe("suspended");
  expect(await page.evaluate(() => window.rhythmAudioProbe.voices.every((voice) => voice.stopped))).toBe(true);
  expect(errors).toEqual([]);
});

test("scheduled tempo crossfade completes while UI callbacks are hidden", async ({ page }) => {
  await openPlayer(page);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("slider", { name: "Tempo" }).fill("120");
  await expect.poll(() => page.evaluate(() => window.rhythmAudioProbe.voices.length)).toBe(2);
  await setHidden(page, true);
  await expect.poll(() => page.evaluate(() => {
    const probe = window.rhythmAudioProbe;
    return probe.contexts[0].currentTime - probe.voices[1].when;
  })).toBeGreaterThan(0.1);
  expect(await page.evaluate(() => window.rhythmAudioProbe.voices.map((voice) => voice.gain!.gain.value))).toEqual([0, 1]);
  expect(await page.evaluate(() => window.rhythmAudioProbe.voices[0].stopped)).toBe(false);
  await setHidden(page, false);
  await expect.poll(() => page.evaluate(() => window.rhythmAudioProbe.voices[0].stopped)).toBe(true);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

test("a newer tempo cancels a scheduled source without silencing the original loop", async ({ page }) => {
  await openPlayer(page);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("slider", { name: "Tempo" }).fill("80");
  await expect.poll(() => page.evaluate(() => window.rhythmAudioProbe.voices.length)).toBe(2);
  await page.getByRole("slider", { name: "Tempo" }).fill("100");
  await expect.poll(() => page.evaluate(() => window.rhythmAudioProbe.voices.length)).toBe(3);
  expect(await page.evaluate(() => window.rhythmAudioProbe.voices[1].stopped)).toBe(true);
  expect(await page.evaluate(() => window.rhythmAudioProbe.voices[0].gain!.gain.value)).toBe(1);
  expect(await page.evaluate(() => window.rhythmAudioProbe.voices[2].source.buffer!.duration)).toBeCloseTo(2.4, 4);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  expect(await page.evaluate(() => window.rhythmAudioProbe.voices.every((voice) => voice.stopped))).toBe(true);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  expect(await page.evaluate(() => window.rhythmAudioProbe.voices[3].source.buffer!.duration)).toBeCloseTo(2.4, 4);
});

test("finishing an in-flight render cannot undo Stop and only the latest tempo is installed", async ({ page }) => {
  await openPlayer(page);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.evaluate(() => { window.rhythmAudioProbe.holdRenders = true; });
  const slider = page.getByRole("slider", { name: "Tempo" });
  await slider.fill("30");
  await expect.poll(() => page.evaluate(() => window.rhythmAudioProbe.heldRenders.length)).toBe(1);
  await slider.fill("130");
  await slider.fill("100");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.evaluate(() => {
    window.rhythmAudioProbe.holdRenders = false;
    window.rhythmAudioProbe.heldRenders.splice(0).forEach((release) => release());
  });
  await expect.poll(() => page.evaluate(() => window.rhythmAudioProbe.buffers.length)).toBe(3);
  await expect.poll(() => page.evaluate(() => window.rhythmAudioProbe.contexts[0].state)).toBe("suspended");
  expect(await page.evaluate(() => window.rhythmAudioProbe.voices.length)).toBe(1);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  expect(await page.evaluate(() => window.rhythmAudioProbe.voices[1].source.buffer!.duration)).toBeCloseTo(2.4, 4);
});

test("mute renders silence and disabling loop plays the final decay then stops", async ({ page }) => {
  await openPlayer(page);
  await page.getByRole("button", { name: "Mute Alfaia", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.rhythmAudioProbe.buffers.length)).toBe(2);
  const peak = await page.evaluate(() => window.rhythmAudioProbe.buffers[1].getChannelData(0)
    .reduce((max, value) => Math.max(max, Math.abs(value)), 0));
  expect(peak).toBe(0);
  await page.getByRole("button", { name: "Unmute Alfaia", exact: true }).click();
  await page.getByRole("button", { name: "Disable loop", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.rhythmAudioProbe.buffers.at(-1)!.duration)).toBeGreaterThan(3);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  expect(await page.evaluate(() => window.rhythmAudioProbe.voices[0].source.loop)).toBe(false);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => window.rhythmAudioProbe.voices[0].ended)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.rhythmAudioProbe.contexts[0].state)).toBe("suspended");
});

test("a change prepared while hidden keeps the current buffer until returning", async ({ page }) => {
  await openPlayer(page);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await setHidden(page, true);
  await page.getByRole("slider", { name: "Tempo" }).fill("120");
  await expect.poll(() => page.evaluate(() => window.rhythmAudioProbe.buffers.length)).toBe(2);
  expect(await page.evaluate(() => window.rhythmAudioProbe.voices.length)).toBe(1);
  expect(await page.evaluate(() => window.rhythmAudioProbe.contexts[0].state)).toBe("running");
  await setHidden(page, false);
  await expect.poll(() => page.evaluate(() => window.rhythmAudioProbe.voices.length)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.rhythmAudioProbe.voices[0].stopped)).toBe(true);
});

test("an interrupted context reports Play and resumes the same source only on request", async ({ page }) => {
  await openPlayer(page);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.evaluate(async () => { await window.rhythmAudioProbe.contexts[0].suspend(); });
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(page.locator(".player-status")).toContainText("Playback was interrupted");
  await setHidden(page, true);
  await setHidden(page, false);
  expect(await page.evaluate(() => window.rhythmAudioProbe.resumeCalls)).toBe(1);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.rhythmAudioProbe.voices.length)).toBe(1);
});

test("media-session pause preserves position and navigation stops audio", async ({ page }) => {
  await openPlayer(page);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.rhythmAudioProbe.contexts[0].currentTime)).toBeGreaterThan(0.2);
  await page.evaluate(() => window.rhythmAudioProbe.actions.pause!({ action: "pause" }));
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await page.evaluate(() => window.rhythmAudioProbe.actions.play!({ action: "play" }));
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.rhythmAudioProbe.voices[1].offset)).toBeGreaterThan(0.2);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.rhythmAudioProbe.voices.every((voice) => voice.stopped))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.rhythmAudioProbe.contexts[0].state)).toBe("suspended");
});

test("sample failures can be retried without reloading", async ({ page }) => {
  await page.route("**/samples/**", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
  await page.goto("/rhythms/marcacao/");
  await expect(page.locator(".player-status")).toContainText("Unable to load");
  await page.unroute("**/samples/**");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.rhythmAudioProbe.buffers.length)).toBe(1);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
});

test("renderer preserves subdivision timing, wrapped decays, and seamless buffer repetition", async ({ page }) => {
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
      const { buffer } = await renderRhythm({
        rhythm: { subdivision, tracks: [{ name: "Test", steps: [".", "X", ".", "."] }] },
        samples: { "Test.X": "unused" }, tempo: 120, loop: false, mutedTracks: [],
      }, cache);
      timings.push(buffer.getChannelData(0).findIndex((value: number) => Math.abs(value) > 0.1) / rate);
    }
    // Eight complete frame-aligned cycles make a constant overlapping signal.
    const tail = new AudioBuffer({ length: Math.round(rate / 8) * 8, sampleRate: rate });
    tail.getChannelData(0).fill(0.8);
    const request = {
      rhythm: { subdivision: 16, tracks: [{ name: "Test", steps: ["X"] }] },
      samples: { "Test.X": "unused" }, tempo: 120, loop: true, mutedTracks: [],
    };
    const looped = await renderRhythm(request, { load: async () => tail });
    const data = looped.buffer.getChannelData(0);
    const oneShot = await renderRhythm({ ...request, loop: false }, { load: async () => tail });
    // Render three actual native repetitions: any added silence at the boundary fails.
    const renderer = new OfflineAudioContext(2, looped.buffer.length * 3, rate);
    const source = renderer.createBufferSource();
    source.buffer = looped.buffer;
    source.loop = true;
    source.connect(renderer.destination);
    source.start();
    const repeated = (await renderer.startRendering()).getChannelData(0);
    return {
      timings,
      peak: data.reduce((max: number, value: number) => Math.max(max, Math.abs(value)), 0),
      minimum: repeated.reduce((min: number, value: number) => Math.min(min, value), 1),
      duration: looped.buffer.duration, cycleDuration: looped.cycleDuration,
      tailDuration: oneShot.buffer.duration,
      sampleDuration: tail.duration,
    };
  });
  expect(result.timings[0]).toBeCloseTo(0.25, 4);
  expect(result.timings[1]).toBeCloseTo(0.125, 4);
  expect(result.timings[2]).toBeCloseTo(0.0625, 4);
  expect(result.peak).toBeLessThanOrEqual(0.981);
  expect(result.minimum).toBeGreaterThan(0.9);
  expect(result.duration).toBe(result.cycleDuration);
  expect(result.tailDuration).toBe(result.sampleDuration);
});

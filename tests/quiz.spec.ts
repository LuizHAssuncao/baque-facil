import { expect, test, type Page } from "@playwright/test";
import { buildQuizRhythms, createQuizRound, QUIZ_TEMPO, type QuizLibrary } from "../src/lib/rhythmQuiz";
import { parseRhythm } from "../src/lib/parseRhythm";
import type { Rhythm } from "../src/lib/rhythmTypes";
import { sampleMap } from "../src/lib/sampleMap";

const rhythms: Rhythm[] = [
  { title: "Marcação", slug: "marcacao", tempo: 90, subdivision: 16, tracks: parseRhythm("Alfaia:\nR . . . | . . . . | L R . . | L R . .") },
  { title: "Imalê", slug: "imale", tempo: 100, subdivision: 16, tracks: parseRhythm("Alfaia:\nL . R . | L R . . | L R . . | R . . .") },
  { title: "Trovão", slug: "trovao", tempo: 95, subdivision: 16, tracks: parseRhythm("Alfaia:\nR . L R | . R L . | R . L . | . . . .") },
];
const library: QuizLibrary = { rhythms, samples: sampleMap };

async function mockLibrary(page: Page, getLibrary = () => library) {
  // A fixed shuffle makes the feedback flow reproducible: first prompt is Imalê, answer C.
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.route("**/quiz/rhythms.json", (route) => route.fulfill({ json: getLibrary() }));
}

async function waitForAudio(page: Page) {
  for (const label of ["A", "B", "C"]) {
    await expect(page.getByRole("button", { name: `Play audio ${label}`, exact: true })).toBeEnabled();
  }
}

test("quiz eligibility follows library additions and rejects unplayable patterns", () => {
  const entry = {
    slug: "new-library-rhythm",
    data: { title: "New library rhythm", tempo: 90, subdivision: 16 as const, difficulty: "beginner", instruments: ["Alfaia"] },
    body: "```rhythm\nAlfaia:\nR . L .\n```",
  };
  expect(buildQuizRhythms([])).toEqual([]);
  expect(buildQuizRhythms([entry])).toMatchObject([{ slug: entry.slug, title: entry.data.title }]);
  const invalid = ["No rhythm block", "```rhythm\nR L\n```", "```rhythm\nAlfaia:\nQ .\n```", "```rhythm\nAlfaia:\n. . . .\n```", "```rhythm\nAlfaia:\nR .\nCaixa:\nX\n```"];
  for (const body of invalid) expect(buildQuizRhythms([{ ...entry, body }])).toEqual([]);
});

test("rounds keep one correct answer, distinct sounds, and no consecutive prompt repeats", () => {
  const duplicate = { ...rhythms[0], slug: "same-audio", title: "Another name" };
  const finerNotation: Rhythm = {
    ...duplicate,
    slug: "same-audio-finer-notation",
    subdivision: 32,
    tracks: rhythms[0].tracks.map((track) => ({ ...track, steps: track.steps.flatMap((step) => [step, "."]) })),
  };
  expect(createQuizRound({ ...library, rhythms: [rhythms[0], duplicate, finerNotation, rhythms[1]] })).toBeNull();
  let previousSlug: string | undefined;
  const positions = new Set<number>();
  const prompts = new Set<string>();
  for (let index = 0; index < 80; index += 1) {
    const round = createQuizRound(library, previousSlug)!;
    expect(round.options).toHaveLength(3);
    expect(new Set(round.options.map((rhythm) => rhythm.slug)).size).toBe(3);
    expect(round.options.filter((rhythm) => rhythm.slug === round.prompt.slug)).toHaveLength(1);
    expect(round.prompt.slug).not.toBe(previousSlug);
    positions.add(round.options.findIndex((rhythm) => rhythm.slug === round.prompt.slug));
    prompts.add(round.prompt.slug);
    previousSlug = round.prompt.slug;
  }
  expect(positions.size).toBe(3);
  expect(prompts.size).toBe(3);
});

test("quiz gives clear feedback and advances only after a correct answer", async ({ page }, testInfo) => {
  const errors: string[] = [];
  let requests = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  await mockLibrary(page, () => { requests += 1; return library; });
  await page.clock.install({ time: new Date("2026-10-01T12:00:00Z") });
  await page.goto("/");
  await page.getByRole("link", { name: /Rhythm quiz/ }).click();
  await expect(page).toHaveURL("/quiz/");
  await waitForAudio(page);
  await expect(page.locator("#quiz-prompt")).toHaveText("Imalê");
  await expect(page.locator(".quiz-options > li")).toHaveCount(3);
  await expect(page.locator(".rhythm-grid, .step-cell, pre, textarea, audio, canvas, .content")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /transcription/i })).toHaveCount(0);
  await expect(page.locator(".quiz-options")).not.toContainText(/Marcação|Imalê|Trovão/);
  await page.clock.pauseAt(new Date("2026-10-01T12:01:00Z"));

  const feedback = page.getByRole("status", { name: "Answer feedback" });
  await page.getByRole("button", { name: "Choose option A" }).click();
  await expect(feedback).toContainText("Incorrect — try again");
  await expect(feedback).toContainText("Option A doesn’t match this rhythm.");
  await expect(feedback).toHaveAttribute("data-result", "incorrect");
  await expect(feedback).toBeInViewport({ ratio: 1 });
  await expect(page.locator(".quiz-option").first()).toContainText("Not a match");
  await expect(page.getByRole("button", { name: "Skip", exact: true })).toBeEnabled();
  await page.clock.fastForward(4_000);
  await expect(page.locator("#quiz-prompt")).toHaveText("Imalê");
  expect(requests).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("quiz-incorrect.png"), fullPage: true });

  await page.getByRole("button", { name: "Choose option C" }).click();
  await expect(feedback).toContainText("Correct!");
  await expect(feedback).toContainText("Option C matches Imalê. Moving to the next rhythm…");
  await expect(feedback).toHaveAttribute("data-result", "correct");
  await expect(feedback).toHaveAttribute("aria-atomic", "true");
  await expect(feedback).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "Option C is correct" })).toBeDisabled();
  await expect(page.locator(".quiz-choose:enabled")).toHaveCount(0);
  await expect(page.locator(".rhythm-grid, .step-cell, pre, textarea")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("quiz-correct.png"), fullPage: true });

  await page.clock.fastForward(1_500);
  await expect(page.locator("#quiz-prompt")).toHaveText("Imalê");
  expect(requests).toBe(1);
  await page.clock.fastForward(500);
  await expect(page.locator("#quiz-prompt")).not.toHaveText("Imalê");
  await page.clock.resume();
  await waitForAudio(page);
  await expect(page.locator("#quiz-prompt")).toBeFocused();
  await expect(page.locator("#quiz-prompt")).toBeInViewport();
  await expect(feedback).toHaveText("Take your time.");
  expect(requests).toBe(2);
  expect(errors).toEqual([]);
});

test("manual next cancels the automatic advance instead of skipping another rhythm", async ({ page }) => {
  let requests = 0;
  await mockLibrary(page, () => { requests += 1; return library; });
  await page.clock.install({ time: new Date("2026-10-01T12:00:00Z") });
  await page.goto("/quiz/");
  await waitForAudio(page);
  await page.clock.pauseAt(new Date("2026-10-01T12:01:00Z"));
  await page.getByRole("button", { name: "Choose option C" }).click();
  await expect(page.getByRole("status", { name: "Answer feedback" })).toContainText("Correct!");
  await page.getByRole("button", { name: "Next rhythm" }).click();
  await page.clock.resume();
  await waitForAudio(page);
  const nextPrompt = await page.locator("#quiz-prompt").textContent();
  expect(requests).toBe(2);
  await page.clock.fastForward(5_000);
  await expect(page.locator("#quiz-prompt")).toHaveText(nextPrompt!);
  expect(requests).toBe(2);
});

test("next round refreshes the library and supports an insufficient pool", async ({ page }) => {
  let currentLibrary = library;
  let requests = 0;
  await mockLibrary(page, () => { requests += 1; return currentLibrary; });
  await page.goto("/quiz/");
  await waitForAudio(page);
  expect(requests).toBe(1);
  currentLibrary = {
    ...library,
    rhythms: rhythms.map((rhythm) => ({ ...rhythm, slug: `new-${rhythm.slug}`, title: `New ${rhythm.title}` })),
  };
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await waitForAudio(page);
  await expect(page.locator("#quiz-prompt")).toHaveText("New Imalê");
  expect(requests).toBe(2);
  currentLibrary = { ...library, rhythms: rhythms.slice(0, 2) };
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByRole("heading", { name: "More rhythms needed" })).toBeVisible();
  await expect(page.locator(".quiz-option")).toHaveCount(0);
  currentLibrary = library;
  await page.getByRole("button", { name: "Try again" }).click();
  await waitForAudio(page);
});

test("library failures can be retried", async ({ page }) => {
  let fail = true;
  await page.route("**/quiz/rhythms.json", (route) => fail
    ? route.fulfill({ status: 503, body: "Unavailable" })
    : route.fulfill({ json: library }));
  await page.goto("/quiz/");
  await expect(page.getByRole("heading", { name: "The rhythms couldn’t load" })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await waitForAudio(page);
});

test("audio failures can be retried without starting playback automatically", async ({ page }) => {
  await mockLibrary(page);
  let fail = true;
  await page.route("**/samples/**", (route) => fail
    ? route.fulfill({ status: 503, body: "Unavailable" })
    : route.continue());
  await page.goto("/quiz/");
  await expect(page.getByRole("button", { name: "Retry audio A" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose option A" })).toBeDisabled();
  fail = false;
  await page.getByRole("button", { name: "Retry audio A" }).click();
  await expect(page.getByRole("button", { name: "Play audio A" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Choose option A" })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Stop audio/ })).toHaveCount(0);
});

test("audio uses real samples, one source at a time, anonymous titles, and stops between rounds", async ({ page }) => {
  await mockLibrary(page);
  await page.addInitScript(() => {
    const probe = { voices: [] as { stopped: boolean; loop: boolean; duration: number; hasSound: boolean }[], contexts: [] as AudioContext[] };
    (window as unknown as { quizAudioProbe: typeof probe }).quizAudioProbe = probe;
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) { super(options); probe.contexts.push(this); }
      createBufferSource() {
        const source = super.createBufferSource();
        const voice = { stopped: false, loop: false, duration: 0, hasSound: false };
        const start = source.start.bind(source);
        source.start = (when = 0, offset = 0) => {
          voice.loop = source.loop;
          voice.duration = source.buffer!.duration;
          voice.hasSound = source.buffer!.getChannelData(0).some((value) => Math.abs(value) > 0.001);
          probe.voices.push(voice);
          start(when, offset);
        };
        const stop = source.stop.bind(source);
        source.stop = () => { voice.stopped = true; stop(); };
        return source;
      }
    };
  });
  const probe = () => page.evaluate(() => {
    const value = (window as unknown as { quizAudioProbe: { voices: { stopped: boolean; loop: boolean; duration: number; hasSound: boolean }[]; contexts: AudioContext[] } }).quizAudioProbe;
    return { voices: value.voices, contexts: value.contexts.map((context) => context.state) };
  });
  await page.goto("/quiz/");
  await waitForAudio(page);
  expect((await probe()).voices).toEqual([]);
  await page.getByRole("button", { name: "Play audio A" }).click();
  await expect(page.getByRole("button", { name: "Stop audio A" })).toBeVisible();
  await page.getByRole("button", { name: "Play audio B" }).click();
  await expect(page.getByRole("button", { name: "Stop audio B" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay audio A" })).toBeVisible();
  expect((await probe()).voices.map((voice) => voice.stopped)).toEqual([true, false]);
  expect(await page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe("Option B");
  await page.getByRole("button", { name: "Stop audio B" }).click();
  await page.getByRole("button", { name: "Replay audio B" }).click();
  await expect(page.getByRole("button", { name: "Stop audio B" })).toBeVisible();
  const voices = (await probe()).voices;
  expect(voices).toHaveLength(3);
  expect(voices.every((voice) => !voice.loop && voice.hasSound)).toBe(true);
  expect(voices.every((voice) => voice.duration >= (60 / QUIZ_TEMPO) * 4)).toBe(true);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await waitForAudio(page);
  await expect.poll(async () => (await probe()).voices.every((voice) => voice.stopped)).toBe(true);
  await expect.poll(async () => (await probe()).contexts.every((state) => state === "closed")).toBe(true);
  await page.getByRole("button", { name: "Play audio A" }).click();
  // A full cycle finishes naturally and the same button becomes Replay.
  await expect(page.getByRole("button", { name: "Replay audio A" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Replay audio A" }).click();
  await page.getByRole("button", { name: "Choose option A" }).click();
  expect((await probe()).voices.every((voice) => voice.stopped)).toBe(true);
});

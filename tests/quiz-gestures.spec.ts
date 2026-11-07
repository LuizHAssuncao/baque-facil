import { expect, test, type Page } from "@playwright/test";
import { buildQuizRhythms, createQuizRound, type QuizLibrary, type QuizRhythm } from "../src/lib/rhythmQuiz";
import { parseRhythm } from "../src/lib/parseRhythm";
import { sampleMap } from "../src/lib/sampleMap";

const rhythms: QuizRhythm[] = [
  { title: "Marcação", slug: "marcacao", tempo: 90, subdivision: 16,
    tracks: parseRhythm("Alfaia:\nR . . . | . . . . | L R . . | L R . ."),
    gesture: { src: "/hand-signals/marcacao.png", description: { "en-CA": "One raised finger.", "pt-BR": "Um dedo levantado." } } },
  { title: "Imalê", slug: "imale", tempo: 100, subdivision: 16,
    tracks: parseRhythm("Alfaia:\nL . R . | L R . . | L R . . | R . . ."),
    gesture: { src: "/hand-signals/imale.png", description: { "en-CA": "Two raised fingers.", "pt-BR": "Dois dedos levantados." } } },
  { title: "Trovão", slug: "trovao", tempo: 95, subdivision: 16,
    tracks: parseRhythm("Alfaia:\nR . L R | . R L . | R . L . | . . . ."),
    gesture: { src: "/hand-signals/trovao.png", description: { "en-CA": "An open hand.", "pt-BR": "Uma mão aberta." } } },
];
const library: QuizLibrary = { rhythms, samples: sampleMap };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("baque-facil-language", "en-CA"));
});

async function mockLibrary(page: Page, getLibrary = () => library) {
  // Name mode starts with Imalê; switching avoids repeating it and shows Trovão, answer C.
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.route("**/quiz/rhythms.json", (route) => route.fulfill({ json: getLibrary() }));
}

async function ready(page: Page) {
  for (const label of ["A", "B", "C"]) {
    await expect(page.getByRole("button", { name: `Play audio ${label}`, exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: `Choose option ${label}`, exact: true })).toBeEnabled();
  }
}

test("gesture metadata comes from lessons and gesture rounds require three distinct sounds", () => {
  const entry = {
    slug: "lesson", data: { title: "Lesson", tempo: 90, subdivision: 16 as const, gesture: rhythms[0].gesture },
    body: "```rhythm\nAlfaia:\nR . L .\n```",
  };
  expect(buildQuizRhythms([entry])[0].gesture).toEqual(rhythms[0].gesture);
  const partial = { ...library, rhythms: rhythms.map((rhythm, index) => index === 0 ? { ...rhythm, gesture: undefined } : rhythm) };
  expect(createQuizRound(partial, undefined, "gesture")).toBeNull();
  expect(createQuizRound(partial)).not.toBeNull();
  const duplicate = { ...rhythms[0], slug: "duplicate", gesture: rhythms[2].gesture };
  expect(createQuizRound({ ...library, rhythms: [rhythms[0], duplicate, rhythms[1]] }, undefined, "gesture")).toBeNull();
  const unassigned = { ...rhythms[0], slug: "no-gesture", gesture: undefined };
  let previousSlug: string | undefined;
  for (let index = 0; index < 20; index += 1) {
    const round = createQuizRound({ ...library, rhythms: [...rhythms, unassigned] }, previousSlug, "gesture")!;
    expect(round.prompt.slug).not.toBe(previousSlug);
    expect(round.options.every((rhythm) => Boolean(rhythm.gesture?.src))).toBe(true);
    expect(round.options.filter((rhythm) => rhythm.slug === round.prompt.slug)).toHaveLength(1);
    previousSlug = round.prompt.slug;
  }
});

test("gesture-first practice hides names, supports retries and advances to another signal", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockLibrary(page);
  await page.clock.install({ time: new Date("2026-10-01T12:00:00Z") });
  await page.goto("/quiz/");
  await ready(page);
  const nameMode = page.getByRole("radio", { name: "Rhythm name", exact: true });
  await expect(nameMode).toBeChecked();
  await nameMode.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Hand gesture", exact: true })).toBeChecked();
  await ready(page);
  await expect(page.locator("#quiz-prompt")).toHaveText("Watch the hand gesture");
  await expect(page.locator("#quiz-prompt")).toBeFocused();
  const gesture = page.getByRole("img", { name: "An open hand." });
  await expect(gesture).toHaveAttribute("src", "/hand-signals/trovao.png");
  expect(await gesture.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator(".quiz-practice")).not.toContainText(/Marcação|Imalê|Trovão/);
  await expect(page.getByRole("button", { name: /Stop audio/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("quiz-gesture.png"), fullPage: true });
  await page.clock.pauseAt(new Date("2026-10-01T12:01:00Z"));

  const feedback = page.getByRole("status", { name: "Answer feedback" });
  await page.getByRole("button", { name: "Choose option A" }).click();
  await expect(feedback).toContainText("Incorrect — try again");
  await expect(feedback).toContainText("Option A is Imalê.");
  await expect(feedback).not.toContainText("Trovão");
  await page.clock.fastForward(3_000);
  await expect(gesture).toBeVisible();
  await page.getByRole("button", { name: "Choose option C" }).click();
  await expect(feedback).toContainText("Option C matches Trovão.");
  await expect(page.locator(".quiz-choose:enabled")).toHaveCount(0);
  await page.clock.fastForward(2_000);
  await page.clock.resume();
  await ready(page);
  await expect(page.getByRole("img", { name: "Two raised fingers." })).toBeVisible();
  await expect(feedback).toHaveText("Take your time.");
  expect(errors).toEqual([]);
});

test("mode changes stop audio and cancel pending automatic advancement", async ({ page }) => {
  let requests = 0;
  await mockLibrary(page, () => { requests += 1; return library; });
  await page.clock.install({ time: new Date("2026-10-01T12:00:00Z") });
  await page.addInitScript(() => {
    const contexts: AudioContext[] = [];
    (window as unknown as { quizContexts: AudioContext[] }).quizContexts = contexts;
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) { super(options); contexts.push(this); }
    };
  });
  await page.goto("/quiz/");
  await ready(page);
  await page.getByRole("button", { name: "Play audio A" }).click();
  await expect(page.getByRole("button", { name: "Stop audio A" })).toBeVisible();
  await page.getByRole("radio", { name: "Hand gesture", exact: true }).check();
  await ready(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { quizContexts: AudioContext[] }).quizContexts.every((context) => context.state === "closed"))).toBe(true);
  await expect(page.getByRole("button", { name: /Stop audio/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Play audio B" }).click();
  await expect(page.getByRole("button", { name: "Stop audio B" })).toBeVisible();
  expect(await page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe("Option B");
  await page.getByRole("button", { name: "Stop audio B" }).click();
  await page.clock.pauseAt(new Date("2026-10-01T12:01:00Z"));
  await page.getByRole("button", { name: "Choose option C" }).click();
  await expect(page.getByRole("status", { name: "Answer feedback" })).toContainText("Correct!");
  await page.getByRole("radio", { name: "Rhythm name", exact: true }).check();
  await page.clock.resume();
  await ready(page);
  await expect(page.locator("#quiz-prompt")).toHaveText("Imalê");
  expect(requests).toBe(3);
  await page.clock.fastForward(5_000);
  await expect(page.locator("#quiz-prompt")).toHaveText("Imalê");
  expect(requests).toBe(3);
  await expect(page.getByRole("status", { name: "Answer feedback" })).toHaveText("Take your time.");
});

test("a library without gestures can return to name practice", async ({ page }) => {
  await mockLibrary(page, () => ({ ...library, rhythms: rhythms.map(({ gesture, ...rhythm }) => rhythm) }));
  await page.goto("/quiz/");
  await ready(page);
  await page.getByRole("radio", { name: "Hand gesture", exact: true }).check();
  await expect(page.getByRole("heading", { name: "More hand gestures needed" })).toBeVisible();
  await expect(page.locator(".quiz-option")).toHaveCount(0);
  await page.getByRole("radio", { name: "Rhythm name", exact: true }).check();
  await ready(page);
  await expect(page.locator("#quiz-prompt")).toHaveText("Imalê");
});

test("original animated signals and translated descriptions survive language changes", async ({ page }, testInfo) => {
  const animation = { src: "/hand-signals/martelo-break.webp", description: { "en-CA": "A closed fist moves up and down.", "pt-BR": "Um punho fechado se move para cima e para baixo." } };
  await mockLibrary(page, () => ({ ...library, rhythms: rhythms.map((rhythm) => rhythm.slug === "trovao" ? { ...rhythm, gesture: animation } : rhythm) }));
  await page.goto("/quiz/");
  await ready(page);
  await page.getByRole("radio", { name: "Hand gesture", exact: true }).check();
  await ready(page);
  const image = page.locator(".quiz-hand-gesture img");
  await expect(image).toHaveAttribute("src", animation.src);
  await expect(image).toHaveCSS("object-fit", "contain");
  expect(await image.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(480);
  await page.getByRole("button", { name: "Choose option A" }).click();
  await page.locator(".language-bar").getByRole("button", { name: "Português (Brasil)" }).click();
  await expect(page.getByRole("group", { name: "Mostrar primeiro" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Gesto de mão", exact: true })).toBeChecked();
  await expect(page.locator("#quiz-prompt")).toHaveText("Observe o gesto de mão");
  await expect(image).toHaveAttribute("alt", animation.description["pt-BR"]);
  await expect(page.getByRole("status", { name: "Resultado da resposta" })).toContainText("A opção A é Imalê.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("quiz-gesture-portuguese.png"), fullPage: true });
  await page.getByRole("button", { name: "Escolher opção C" }).click();
  await expect(page.getByRole("status", { name: "Resultado da resposta" })).toContainText("A opção C corresponde a Trovão.");
});

test("failed images disable guesses and Skip recovers without revealing the name", async ({ page }) => {
  await mockLibrary(page);
  await page.route("**/hand-signals/trovao.png", (route) => route.abort());
  await page.goto("/quiz/");
  await ready(page);
  await page.getByRole("radio", { name: "Hand gesture", exact: true }).check();
  await expect(page.getByRole("alert")).toContainText("The hand gesture couldn’t load.");
  await expect(page.locator(".quiz-choose:enabled")).toHaveCount(0);
  await expect(page.locator(".quiz-practice")).not.toContainText("Trovão");
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await ready(page);
  await expect(page.getByRole("img", { name: "Two raised fingers." })).toBeVisible();
});

test("the real quiz endpoint serves every lesson signal and usable original assets", async ({ page, request }) => {
  const response = await request.get("/quiz/rhythms.json");
  expect(response.ok()).toBe(true);
  const actual: QuizLibrary = await response.json();
  const sources = actual.rhythms.flatMap((rhythm) => rhythm.gesture ? [rhythm.gesture.src] : []).sort();
  expect(sources).toEqual(expect.arrayContaining([
    "/hand-signals/afoxe.png", "/hand-signals/arrasto.png", "/hand-signals/combo_parada_arrasto.png", "/hand-signals/imale.png",
    "/hand-signals/marcacao.png", "/hand-signals/martelo-break.webp", "/hand-signals/martelo.png",
    "/hand-signals/parada.png", "/hand-signals/trovao.png",
  ]));
  for (const source of sources) expect((await request.get(source)).ok()).toBe(true);
  await page.goto("/quiz/");
  await ready(page);
  await page.getByRole("radio", { name: "Hand gesture", exact: true }).check();
  await ready(page);
  const image = page.locator(".quiz-hand-gesture img");
  expect(sources).toContain(await image.getAttribute("src"));
  expect(await image.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
});

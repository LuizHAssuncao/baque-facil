import { expect, test, type Locator, type Page } from "@playwright/test";

const displayKey = "baque-facil-radio-display-v1";
const settings = { slugs: ["marcacao", "imale"], tempo: 120, repetitions: 4, minutes: 2 };
const gestures: Record<string, string> = {
  "1 - Marcação": "/hand-signals/marcacao.png",
  "2 - Imalê": "/hand-signals/imale.png",
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("baque-facil-language", "en-CA"));
});

async function openRadio(page: Page, slugs = settings.slugs) {
  await page.addInitScript((value) => {
    localStorage.setItem("baque-facil-radio-v1", JSON.stringify(value));
  }, { ...settings, slugs });
  await page.goto("/radio/");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible({ timeout: 25_000 });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  return page.locator("audio[data-radio-player]");
}

async function seek(audio: Locator, seconds: number) {
  await audio.evaluate((element: HTMLAudioElement, seconds) => {
    element.currentTime = seconds;
    element.dispatchEvent(new Event("timeupdate"));
  }, seconds);
}

test("the last two repetitions call the next gesture while the current notes follow the recording", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const audio = await openRadio(page);
  const source = await audio.getAttribute("src");
  const currentTitle = await page.locator(".radio-now h2").innerText();
  const nextTitle = await page.locator(".radio-next strong").innerText();
  expect(nextTitle).not.toBe(currentTitle);
  const cue = page.getByRole("region", { name: "Next rhythm signal", exact: true });

  await seek(audio, 3.999);
  await expect(cue).toHaveAttribute("data-phase", "waiting");
  await expect(cue.locator("img")).toHaveCount(0);
  await seek(audio, 4);
  await expect(cue).toHaveAttribute("data-phase", "call");
  await expect(cue.locator("img")).toHaveAttribute("src", gestures[nextTitle]);
  await expect.poll(() => cue.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator(".radio-now h2")).toHaveText(currentTitle);
  await expect(page.locator(".radio-pattern")).toContainText("Repetition 3 of 4");
  await expect(page.locator(".radio-pattern").getByText("Transition", { exact: true })).toHaveCount(0);
  await expect(page.locator(".radio-pattern").getByText("Whistle", { exact: true })).toHaveCount(0);
  await page.locator(".radio-player").screenshot({ path: testInfo.outputPath("radio-signal-call.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await seek(audio, 6);
  await expect(cue).toHaveAttribute("data-phase", "call");
  await expect(page.locator(".radio-pattern")).toContainText("Repetition 4 of 4");
  await expect(page.locator(".radio-pattern").getByText("Transition", { exact: true })).toBeVisible();
  await expect(page.locator(".radio-pattern").getByText("Whistle", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Jump to beat 3, subdivision 2", exact: true }).click();
  expect(await audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeCloseTo(7.125, 4);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  await expect(page.locator(".count-cell").nth(9)).toHaveClass(/active/);
  await expect(cue).toHaveAttribute("data-phase", "call");
  await expect(page.locator(".radio-pattern").getByText("Whistle", { exact: true })).toBeVisible();

  await seek(audio, 8);
  await expect(page.locator(".radio-now h2")).toHaveText(nextTitle);
  await expect(cue).toHaveAttribute("data-phase", "waiting");
  await expect(cue.locator("img")).toHaveCount(0);
  await seek(audio, 124);
  await expect(cue).toHaveAttribute("data-phase", "call");
  await expect(cue.locator("img")).toHaveAttribute("src", gestures[currentTitle]);
  await seek(audio, 0);
  await expect(cue).toHaveAttribute("data-phase", "waiting");
  await expect(page.locator(".radio-now h2")).toHaveText(currentTitle);

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await seek(audio, 4);
  await expect(cue).toHaveAttribute("data-phase", "waiting");
  await page.evaluate(() => {
    delete (document as unknown as { hidden?: boolean }).hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(cue).toHaveAttribute("data-phase", "call");
  await expect(audio).toHaveAttribute("src", source!);

  await page.getByRole("slider", { name: "Radio tempo", exact: true }).fill("90");
  await expect(page.getByRole("button", { name: "Apply settings", exact: true })).toBeVisible();
  await expect(cue.locator("img")).toHaveAttribute("src", gestures[nextTitle]);
  await page.getByRole("button", { name: "Stay on this rhythm", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to mix", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(cue).toHaveAttribute("data-phase", "repeating");
  await expect(cue.locator("img")).toHaveCount(0);
  await page.getByRole("button", { name: "Back to mix", exact: true }).click();
  await expect(page.locator(".radio-now h2")).toHaveText(nextTitle);
  await expect(cue).toHaveAttribute("data-phase", "waiting");
  await expect(audio).toHaveAttribute("src", source!);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.locator(".radio-now h2")).toHaveText(currentTitle);
  await expect(cue).toHaveAttribute("data-phase", "waiting");
  expect(errors).toEqual([]);
});

test("names and notes toggle independently without replacing audio and remain hidden after reload", async ({ page }, testInfo) => {
  const audio = await openRadio(page);
  await seek(audio, 6);
  const source = await audio.getAttribute("src");
  const mixSettings = await page.evaluate(() => localStorage.getItem("baque-facil-radio-v1"));
  const currentTitle = await page.locator(".radio-now h2").innerText();
  const names = page.getByRole("checkbox", { name: "Show rhythm names", exact: true });
  const notes = page.getByRole("checkbox", { name: "Show notes", exact: true });
  const cue = page.locator(".radio-cue");

  await expect(names).toBeChecked();
  await expect(notes).toBeChecked();
  await names.focus();
  await names.press("Space");
  await expect(names).not.toBeChecked();
  await expect(page.locator(".radio-pattern")).toBeVisible();
  await expect(cue.locator("img")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open rhythm lesson →", exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe("Baque Radio");
  for (const title of Object.keys(gestures)) {
    await expect(page.locator(".radio-studio")).not.toContainText(title);
    expect(await page.locator(".radio-studio").ariaSnapshot()).not.toContain(title);
  }
  await notes.uncheck();
  await expect(page.locator(".radio-pattern")).toHaveCount(0);
  await expect(cue.locator("img")).toBeVisible();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  await names.check();
  await expect(page.locator(".radio-now h2")).toHaveText(currentTitle);
  await expect(page.locator(".radio-pattern")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe(currentTitle);
  await names.uncheck();
  await notes.check();
  await expect(page.locator(".radio-pattern")).toBeVisible();
  await notes.uncheck();
  await page.locator(".radio-player").screenshot({ path: testInfo.outputPath("radio-signals-only.png") });

  await expect(audio).toHaveAttribute("src", source!);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeCloseTo(6, 4);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("baque-facil-radio-v1"))).toBe(mixSettings);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), displayKey)).toEqual({ showRhythmNames: false, showNotes: false });

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await notes.check();
  await names.check();
  await expect(audio).toHaveAttribute("src", source!);
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(6);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);
  await notes.uncheck();
  await names.uncheck();

  await page.addInitScript(() => {
    const state = window as unknown as { revealedRhythmName: boolean };
    state.revealedRhythmName = false;
    new MutationObserver(() => {
      if (/Marcação|Imalê/.test(document.body?.innerText ?? "")) state.revealedRhythmName = true;
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  await page.reload();
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await expect(names).not.toBeChecked();
  await expect(notes).not.toBeChecked();
  await expect(audio).not.toHaveAttribute("src");
  expect(await page.evaluate(() => (window as unknown as { revealedRhythmName: boolean }).revealedRhythmName)).toBe(false);
});

test("cue descriptions and visibility controls translate during practice", async ({ page }) => {
  const audio = await openRadio(page);
  await seek(audio, 6);
  const source = await audio.getAttribute("src");
  const image = page.locator(".radio-cue img");
  await expect(image).toHaveAttribute("alt", /^A hand /);
  await page.getByRole("checkbox", { name: "Show rhythm names", exact: true }).uncheck();
  await page.locator(".language-bar").getByRole("button", { name: "Português (Brasil)", exact: true }).click();
  await expect(page.getByRole("region", { name: "Sinal do próximo ritmo", exact: true })).toBeVisible();
  await expect(image).toHaveAttribute("alt", /^Uma mão /);
  await expect(page.getByRole("checkbox", { name: "Mostrar nomes dos ritmos", exact: true })).not.toBeChecked();
  await page.getByRole("checkbox", { name: "Mostrar notas", exact: true }).uncheck();
  await expect(page.locator(".radio-pattern")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe("Rádio Baque");
  await expect(audio).toHaveAttribute("src", source!);
  await page.locator(".language-bar").getByRole("button", { name: "English (Canada)", exact: true }).click();
  await expect(image).toHaveAttribute("alt", /^A hand /);
  await expect(page.getByRole("checkbox", { name: "Show notes", exact: true })).not.toBeChecked();
  await expect(page.locator(".radio-cue [role=status]")).toHaveText("Get ready for the next rhythm");
});

test("unavailable signals retain translated cue titles when names are hidden elsewhere", async ({ page }) => {
  const audio = await openRadio(page, ["marcacao", "combo_three_crossed_break"]);
  if (await page.locator(".radio-now h2").innerText() !== "1 - Marcação") {
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(page.locator(".radio-now h2")).toHaveText("1 - Marcação");
  }
  await page.getByRole("button", { name: "Jump to beat 1", exact: true }).click();
  const start = await audio.evaluate((element: HTMLAudioElement) => element.currentTime);
  await seek(audio, start + 6);
  await page.locator(".language-bar").getByRole("button", { name: "Português (Brasil)", exact: true }).click();
  await expect(page.locator(".radio-next strong")).toHaveText("Three Crossed Break");
  await expect(page.locator(".radio-cue [role=status]")).toHaveText("Próximo ritmo: Three Crossed Break");
  const names = page.getByRole("checkbox", { name: "Mostrar nomes dos ritmos", exact: true });
  await names.uncheck();
  await expect(page.locator(".radio-cue")).toContainText("Sinal indisponível");
  await expect(page.locator(".radio-next strong")).toHaveText("Three Crossed Break");
  await expect(page.locator(".radio-cue [role=status]")).toHaveText("Próximo ritmo: Three Crossed Break");
  for (const selector of [".radio-selection", ".radio-now"]) {
    await expect(page.locator(selector)).not.toContainText("Three Crossed Break");
  }
  await names.check();
  await expect(page.locator(".radio-next strong")).toHaveText("Three Crossed Break");
  await page.getByRole("button", { name: "Pular", exact: true }).click();
  await expect(page.locator(".radio-now h2")).toHaveText("Three Crossed Break");
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe("Three Crossed Break");
  await names.uncheck();
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe("Rádio Baque");
});

test("the next sequence can use its animated gesture and a held rhythm clears the call", async ({ page }) => {
  const audio = await openRadio(page, ["marcacao", "combo_martelo_break"]);
  if (await page.locator(".radio-now h2").innerText() !== "1 - Marcação") {
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(page.locator(".radio-now h2")).toHaveText("1 - Marcação");
  }
  const start = Math.floor(await audio.evaluate((element: HTMLAudioElement) => element.currentTime));
  await seek(audio, start + 6);
  const image = page.locator(".radio-cue img");
  await expect(image).toHaveAttribute("src", "/hand-signals/martelo-break.webp");
  await expect(image).toHaveAttribute("alt", "A closed fist moves up and down.");
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("checkbox", { name: "Show rhythm names", exact: true }).uncheck();
  await expect(page.locator(".radio-studio")).not.toContainText("Martelo break");
  await page.getByRole("button", { name: "Stay on this rhythm", exact: true }).click();
  await expect(page.locator(".radio-cue")).toHaveAttribute("data-phase", "repeating");
  await expect(image).toHaveCount(0);
});

test("a sequence waits until seventy percent to call its next rhythm", async ({ page }, testInfo) => {
  const audio = await openRadio(page, ["marcacao", "combo_martelo_break"]);
  if (await page.locator(".radio-now h2").innerText() !== "Martelo break") {
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(page.locator(".radio-now h2")).toHaveText("Martelo break");
  }
  const start = Math.floor(await audio.evaluate((element: HTMLAudioElement) => element.currentTime));
  const source = await audio.getAttribute("src");
  const cue = page.locator(".radio-cue");
  const image = cue.locator("img");
  await page.getByRole("checkbox", { name: "Show rhythm names", exact: true }).uncheck();
  await expect(cue).toHaveAttribute("data-phase", "waiting");
  await expect(image).toHaveCount(0);
  // Martelo break has 144 sixteenth notes: 18 seconds at 120 BPM.
  await seek(audio, start + 12.599);
  await expect(cue).toHaveAttribute("data-phase", "waiting");
  await seek(audio, start + 12.6);
  await expect(cue).toHaveAttribute("data-phase", "call");
  await expect(image).toHaveAttribute("src", "/hand-signals/marcacao.png");
  await expect(page.locator(".radio-pattern")).toContainText("Repetition 1 of 1");
  await expect(page.locator(".radio-studio")).not.toContainText("Marcação");
  await page.locator(".radio-player").screenshot({ path: testInfo.outputPath("radio-sequence-call.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Seeking back clears the call even within the same note subdivision.
  await seek(audio, start + 12.599);
  await expect(cue).toHaveAttribute("data-phase", "waiting");
  await expect(image).toHaveCount(0);
  await seek(audio, start + 17.999);
  await expect(cue).toHaveAttribute("data-phase", "call");
  await seek(audio, start + 18);
  await expect(cue).toHaveAttribute("data-phase", "waiting");
  await expect(image).toHaveCount(0);
  await expect(page.locator(".radio-pattern")).toContainText("Repetition 1 of 4");
  await expect(audio).toHaveAttribute("src", source!);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
});

test("an unmapped signal reveals the next name only during the call when names are hidden", async ({ page }, testInfo) => {
  const audio = await openRadio(page, ["marcacao", "combo_three_crossed_break"]);
  if (await page.locator(".radio-now h2").innerText() !== "1 - Marcação") {
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(page.locator(".radio-now h2")).toHaveText("1 - Marcação");
  }
  await page.getByRole("button", { name: "Jump to beat 1", exact: true }).click();
  const start = await audio.evaluate((element: HTMLAudioElement) => element.currentTime);
  await page.getByRole("checkbox", { name: "Show rhythm names", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Show notes", exact: true }).uncheck();
  await expect(page.locator(".radio-cue")).not.toContainText("Three Crossed Break");
  await seek(audio, start + 4.01);
  await expect(page.locator(".radio-cue")).toHaveAttribute("data-phase", "call");
  await expect(page.locator(".radio-cue")).toContainText("Signal unavailable");
  await expect(page.locator(".radio-next strong")).toHaveText("Three Crossed Break");
  await expect(page.locator(".radio-cue [role=status]")).toHaveText("Next rhythm: Three Crossed Break");
  await expect(page.locator(".radio-now h2")).toHaveText("Rhythm names hidden");
  await expect(page.locator(".radio-selection")).not.toContainText("Three Crossed Break");
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe("Baque Radio");
  await page.locator(".radio-player").screenshot({ path: testInfo.outputPath("radio-signal-unavailable.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await seek(audio, start + 3.99);
  await expect(page.locator(".radio-cue")).toHaveAttribute("data-phase", "waiting");
  await expect(page.locator(".radio-cue")).not.toContainText("Three Crossed Break");
  await seek(audio, start + 4.01);
  await expect(page.locator(".radio-next strong")).toHaveText("Three Crossed Break");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
});

test("a failed gesture image falls back while the recording remains playable", async ({ page }) => {
  await page.route("**/hand-signals/*.png", (route) => route.abort());
  const audio = await openRadio(page);
  const source = await audio.getAttribute("src");
  const nextTitle = await page.locator(".radio-next strong").innerText();
  await page.getByRole("checkbox", { name: "Show rhythm names", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Show notes", exact: true }).uncheck();
  await seek(audio, 4);
  await expect(page.locator(".radio-cue")).toContainText("Signal unavailable");
  await expect(page.locator(".radio-cue img")).toHaveCount(0);
  await expect(page.locator(".radio-next strong")).toHaveText(nextTitle);
  await expect(page.locator(".radio-cue [role=status]")).toHaveText(`Next rhythm: ${nextTitle}`);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(audio).toHaveAttribute("src", source!);
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
});

for (const unavailable of [false, true]) {
  test(`display controls work with ${unavailable ? "unavailable" : "invalid"} saved preferences`, async ({ page }) => {
    await page.addInitScript(({ key, unavailable }) => {
      if (unavailable) {
        const read = Storage.prototype.getItem;
        const write = Storage.prototype.setItem;
        Storage.prototype.getItem = function (name: string) {
          if (name === key) throw new Error("Storage unavailable");
          return read.call(this, name);
        };
        Storage.prototype.setItem = function (name: string, value: string) {
          if (name === key) throw new Error("Storage unavailable");
          return write.call(this, name, value);
        };
      } else {
        localStorage.setItem(key, JSON.stringify({ showRhythmNames: "false", showNotes: null }));
      }
    }, { key: displayKey, unavailable });
    await page.goto("/radio/");
    const names = page.getByRole("checkbox", { name: "Show rhythm names", exact: true });
    const notes = page.getByRole("checkbox", { name: "Show notes", exact: true });
    await expect(names).toBeEnabled();
    await expect(names).toBeChecked();
    await expect(notes).toBeChecked();
    await names.uncheck();
    await notes.uncheck();
    await expect(names).not.toBeChecked();
    await expect(notes).not.toBeChecked();
    await expect(page.locator(".radio-selection")).not.toContainText("Marcação");
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  });
}

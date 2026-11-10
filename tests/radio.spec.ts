import { expect, test, type Page } from "@playwright/test";

// Existing radio behavior tests run as a returning English visitor.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("baque-facil-language", "en-CA"));
});

const preferences = {
  slugs: ["marcacao", "imale", "martelo"],
  tempo: 90,
  repetitions: 4,
  minutes: 2,
};

async function openRadio(page: Page, settings = preferences) {
  await page.addInitScript((value) => {
    if (!localStorage.getItem("baque-facil-radio-v1"))
      localStorage.setItem("baque-facil-radio-v1", JSON.stringify(value));
  }, settings);
  await page.goto("/radio/");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled();
  return page.locator("audio[data-radio-player]");
}

async function prepare(page: Page) {
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('.radio-cue[data-phase="count-in"]')).toHaveCount(0, { timeout: 10_000 });
}

for (const regularSlugs of [["marcacao"], ["marcacao", "imale"]]) {
  test(`radio separates all sequences with ${regularSlugs.length} selected rhythms through skips, looping, and a fresh shuffle`, async ({ page }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // There are too few distinct rhythms to separate these sequences without reusing them.
    await page.addInitScript(() => { Math.random = () => 0.99; });
    const audio = await openRadio(page, {
      ...preferences,
      slugs: [...regularSlugs, "combo_flying_four", "combo_martelo_break", "combo_parada_arrasto", "combo_three_crossed_break"],
    });
    await prepare(page);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const title = page.locator(".radio-now h2");
    const next = page.locator(".radio-next strong");
    const firstTitle = await title.innerText();
    const sequenceTitles = new Set(["Flying four", "Martelo break", "Parada + Arrasto", "Three Crossed Break"]);
    const regularTitles = regularSlugs.map((slug) => slug === "marcacao" ? "1 - Marcação" : "2 - Imalê");
    const visited = new Set<string>();
    let wrapped = false;
    let lastTitle = "";
    for (let index = 0; index < 40; index += 1) {
      const currentTitle = await title.innerText();
      const nextTitle = await next.innerText();
      visited.add(currentTitle);
      expect(sequenceTitles.has(currentTitle) && sequenceTitles.has(nextTitle)).toBe(false);
      await page.getByRole("button", { name: "Skip", exact: true }).click();
      await expect(title).toHaveText(nextTitle);
      if (await audio.evaluate((element: HTMLAudioElement) => element.currentTime === 0)) {
        wrapped = true;
        lastTitle = currentTitle;
        break;
      }
    }
    expect(wrapped).toBe(true);
    expect([...visited].sort()).toEqual([...regularTitles, ...sequenceTitles].sort());

    // Native playback must retain the same separation across the end of the file.
    await audio.evaluate((element: HTMLAudioElement) => { element.currentTime = element.duration - 0.1; });
    await expect(title).toHaveText(lastTitle);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeLessThan(2);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(title).toHaveText(firstTitle);
    expect(sequenceTitles.has(lastTitle) && sequenceTitles.has(await title.innerText())).toBe(false);

    // Skipping the final group returns to the recorded count-in.
    await audio.evaluate((element: HTMLAudioElement) => { element.currentTime = 240 / 90; });
    await expect(page.locator('.radio-cue[data-phase="count-in"]')).toHaveCount(0);
    if (!sequenceTitles.has(await title.innerText())) {
      await page.getByRole("button", { name: "Skip", exact: true }).click();
      await expect(title).toHaveText(/Flying four|Martelo break|Parada \+ Arrasto|Three Crossed Break/);
    }
    const source = await audio.getAttribute("src");
    await page.getByRole("button", { name: "Shuffle again", exact: true }).click();
    await expect.poll(() => audio.getAttribute("src"), { timeout: 25_000 }).not.toBe(source);
    await expect(title).toHaveText(/1 - Marcação|2 - Imalê/);
    expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("radio header seeks within the current repetition while paused, playing, and held", async ({ page }) => {
  const audio = await openRadio(page, { ...preferences, slugs: ["marcacao"] });
  await prepare(page);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  // Start in the second repetition of a later group, rather than the first cycle.
  const cycle = 4 * 60 / preferences.tempo;
  await audio.evaluate((element: HTMLAudioElement, time) => { element.currentTime = time; }, cycle * 6 + 0.2);
  await page.getByRole("button", { name: "Jump to beat 3, subdivision 2", exact: true }).click();
  expect(await audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeCloseTo(cycle * 6 + 1.5, 4);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  await expect(page.locator(".count-cell").nth(9)).toHaveClass(/active/);
  await expect(page.locator(".radio-pattern-heading")).toContainText("Repetition 2 of 4");
  const pausedTime = await audio.evaluate((element: HTMLAudioElement) => element.currentTime);
  await page.locator(".grid-row:not(.count-row) .step-cell").nth(8).click();
  expect(await audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBe(pausedTime);

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Jump to beat 1", exact: true }).click();
  const playingTime = await audio.evaluate((element: HTMLAudioElement) => element.currentTime);
  expect(playingTime).toBeGreaterThanOrEqual(cycle * 6);
  expect(playingTime).toBeLessThan(cycle * 6 + 1);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);

  await page.getByRole("button", { name: "Stay on this rhythm", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to mix", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await audio.evaluate((element: HTMLAudioElement) => { element.currentTime = 0; });
  await page.getByRole("button", { name: "Jump to beat 4", exact: true }).click();
  expect(await audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeCloseTo(2, 4);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
});

test("radio plays, pauses, seeks, loops natively while hidden, and restores its visible grid", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const audio = await openRadio(page, { ...preferences, slugs: [...preferences.slugs, "combo_entrada", "combo-transition"] });
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem("baque-facil-radio-v1")!).slugs,
  )).toEqual(preferences.slugs);
  await expect(page.getByRole("checkbox", { name: /Entrada|Transition/ })).toHaveCount(0);
  expect(await audio.getAttribute("src")).toBeNull();
  await expect(page.locator(".radio-next")).toHaveCount(0);
  await prepare(page);
  await expect(page.locator(".radio-now h2")).not.toHaveText(/Entrada|Transition/);
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.currentTime),
    )
    .toBeGreaterThan(0.1);
  const title = page.locator(".radio-now h2");
  const next = page.locator(".radio-next strong");
  const firstTitle = await title.textContent();
  const firstNextTitle = await next.textContent();
  await expect(page.locator(".radio-next")).toHaveText(`Next rhythm: ${firstNextTitle}`);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(next).toHaveText(firstNextTitle!);
  const pausedTime = await audio.evaluate(
    (element: HTMLAudioElement) => element.currentTime,
  );
  expect(pausedTime).toBeGreaterThan(0);
  expect(
    await audio.evaluate((element: HTMLAudioElement) => element.paused),
  ).toBe(true);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(title).toHaveText(firstNextTitle!);
  const secondNextTitle = await next.textContent();
  expect(
    await audio.evaluate((element: HTMLAudioElement) => element.paused),
  ).toBe(true);
  const boundary = await audio.evaluate(
    (element: HTMLAudioElement) => element.currentTime,
  );
  await audio.evaluate((element: HTMLAudioElement, seconds) => {
    element.currentTime = seconds - 0.5;
    element.dispatchEvent(new Event("timeupdate"));
  }, boundary);
  await expect(title).toHaveText(firstTitle!);
  await expect(next).toHaveText(firstNextTitle!);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(title).toHaveText(firstNextTitle!);
  await expect(next).toHaveText(secondNextTitle!);
  const source = await audio.getAttribute("src");
  await audio.evaluate((element: HTMLAudioElement) => {
    element.currentTime = element.duration - 2;
    element.dispatchEvent(new Event("timeupdate"));
  });
  await expect(next).toHaveText(firstTitle!);
  await audio.evaluate((element: HTMLAudioElement) => {
    element.currentTime = element.duration - 0.2;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.currentTime),
    )
    .toBeLessThan(2);
  expect(await audio.getAttribute("src")).toBe(source);
  expect(
    await audio.evaluate(
      (element: HTMLAudioElement) => element.loop && !element.paused,
    ),
  ).toBe(true);
  await page.evaluate(() => {
    delete (document as unknown as { hidden?: boolean }).hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(title).toHaveText(firstTitle!);
  await expect(page.locator('.radio-cue[data-phase="count-in"]')).toHaveCount(0);
  await expect(next).toHaveText(firstNextTitle!);
  await expect(page.locator(".radio-pattern .count-cell.active")).toHaveCount(
    1,
  );
  expect(errors).toEqual([]);
});

test("Stay uses a native looping recording and Back to mix restores the original recording", async ({
  page,
}) => {
  const audio = await openRadio(page);
  await prepare(page);
  const original = await audio.getAttribute("src");
  const heldTitle = await page.locator(".radio-now h2").textContent();
  const returnTitle = await page.locator(".radio-next strong").textContent();
  await page
    .getByRole("button", { name: "Stay on this rhythm", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Back to mix", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".radio-next")).toHaveText(`When you return to the mix: ${returnTitle}`);
  const holdSource = await audio.getAttribute("src");
  expect(holdSource).not.toBe(original);
  await audio.evaluate((element: HTMLAudioElement) => {
    element.currentTime = element.duration - 0.2;
  });
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.currentTime),
    )
    .toBeLessThan(2);
  await expect(page.locator(".radio-now h2")).toHaveText(heldTitle!);
  await expect(page.locator(".radio-next strong")).toHaveText(returnTitle!);
  await page.getByRole("button", { name: "Back to mix", exact: true }).click();
  await expect(audio).toHaveAttribute("src", original!);
  await expect(page.locator(".radio-now h2")).toHaveText(returnTitle!);
  await expect(page.locator(".radio-next")).toContainText("Next rhythm:");
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
});

test("Pause during preparation wins, and cancelling another shuffle retains the current recording", async ({
  page,
}) => {
  test.setTimeout(45_000);
  const audio = await openRadio(page);
  await prepare(page);
  const original = await audio.getAttribute("src");
  let release: () => void = () => {};
  let gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/samples/**", async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });
  await page
    .getByRole("button", { name: "Shuffle again", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  release();
  await expect
    .poll(() => audio.getAttribute("src"), { timeout: 20_000 })
    .not.toBe(original);
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toHaveCount(0);
  expect(
    await audio.evaluate((element: HTMLAudioElement) => element.paused),
  ).toBe(true);
  const replacement = await audio.getAttribute("src");
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page
    .getByRole("button", { name: "Shuffle again", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  release();
  await page.unroute("**/samples/**");
  expect(await audio.getAttribute("src")).toBe(replacement);
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
});

test("next rhythm stays with the installed mix until new settings finish preparing", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const audio = await openRadio(page, {
    ...preferences,
    slugs: ["imale", "martelo"],
  });
  await prepare(page);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const original = await audio.getAttribute("src");
  const next = page.locator(".radio-next strong");
  const originalNext = await next.textContent();

  await page.getByRole("checkbox", { name: /^1 - Marcação/ }).check();
  await page.getByRole("checkbox", { name: /^2 - Imalê/ }).uncheck();
  await page.getByRole("checkbox", { name: /^3 - Martelo/ }).uncheck();
  await expect(next).toHaveText(originalNext!);

  await page.route("**/samples/**", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.getByRole("button", { name: "Apply settings", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Unable to load a drum sample");
  await expect(audio).toHaveAttribute("src", original!);
  await expect(next).toHaveText(originalNext!);
  await page.unroute("**/samples/**");

  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/samples/**", async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });
  await page.getByRole("button", { name: "Apply settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await expect(next).toHaveText(originalNext!);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  release();
  await page.unroute("**/samples/**");
  await expect(audio).toHaveAttribute("src", original!);
  await expect(next).toHaveText(originalNext!);

  await page.getByRole("button", { name: "Apply settings", exact: true }).click();
  await expect(audio).not.toHaveAttribute("src", original!, { timeout: 25_000 });
  await expect(page.locator(".radio-now h2")).toHaveText("1 - Marcação");
  await expect(next).toHaveText("1 - Marcação");
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
});

test("failed sample preparation can be retried, and a single selection disables Skip", async ({
  page,
}) => {
  await page.route("**/samples/**", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await openRadio(page, { ...preferences, slugs: ["marcacao"] });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Unable to load a drum sample",
  );
  await page.unroute("**/samples/**");
  await prepare(page);
  await expect(
    page.getByRole("button", { name: "Skip", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".radio-next strong")).toHaveText("1 - Marcação");
  await expect(page.locator(".radio-cue")).toHaveAttribute("data-phase", "repeating");
  await expect(page.locator(".radio-cue img")).toHaveCount(0);
  await page.evaluate(() => {
    localStorage.setItem("baque-facil-reverse-hand-symbols", "true");
    window.dispatchEvent(new Event("baque-facil-hand-symbol-reverse-change"));
  });
  await expect(
    page.locator(".radio-pattern .grid-row:not(.count-row) .step-cell").first(),
  ).toHaveText("L");
  await page.getByRole("checkbox", { name: /^1 - Marcação/ }).uncheck();
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Select at least one rhythm to prepare a mix."),
  ).toBeVisible();
});

test("preferences, optional sequences, and keyboard controls work without autoplay on reload", async ({
  page,
}) => {
  const audio = await openRadio(page);
  const sequence = page.getByRole("checkbox", { name: "Parada + Arrasto Sequence", exact: true });
  await expect(sequence).toBeVisible();
  await expect(sequence).not.toBeChecked();
  await sequence.check();
  await expect(sequence).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Entrada|Transition/ })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Rhythms in the recording", exact: true }).locator("strong")).toHaveText([
    "1 - Marcação",
    "2 - Imalê",
    "3 - Martelo",
    "4 - Baque de Parada",
    "5 - Trovão",
    "7 - Arrasto",
    "# - Afoxé",
  ]);
  await expect(page.getByRole("group", { name: "Sequences in the recording", exact: true }).locator("strong")).toHaveText([
    "Flying four",
    "Martelo break",
    "Parada + Arrasto",
    "Three Crossed Break",
  ]);
  await sequence.uncheck();
  await expect(sequence).toBeVisible();
  await expect(sequence).not.toBeChecked();
  await page.getByRole("slider", { name: "Radio tempo" }).fill("100");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled();
  await page.getByRole("heading", { name: "Baque Radio", exact: true }).click();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible({ timeout: 25_000 });
  await page.keyboard.press("Space");
  expect(
    await audio.evaluate((element: HTMLAudioElement) => element.paused),
  ).toBe(true);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("baque-facil-radio-v1")!),
  );
  expect(saved.tempo).toBe(100);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("slider", { name: "Radio tempo" })).toHaveValue(
    "100",
  );
  expect(await audio.getAttribute("src")).toBeNull();
});

test("all options keep their names and gestures while a single sequence is chosen, played, and restored", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const audio = await openRadio(page);
  const choices = page.locator(".radio-rhythm-choice");
  await expect(choices).toHaveCount(11);
  const titles = await choices.locator("strong").allTextContents();
  for (const choice of await choices.all()) {
    await choice.scrollIntoViewIfNeeded();
    await expect(choice.getByRole("checkbox")).toBeVisible();
    await expect(choice.getByRole("img")).toHaveAttribute("alt", /.+/);
    await expect.poll(() => choice.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  }
  const sequence = page.getByRole("checkbox", { name: "Parada + Arrasto Sequence", exact: true });
  const sequenceCard = choices.filter({ has: sequence });
  await expect(sequenceCard.getByRole("img")).toHaveAttribute("src", "/hand-signals/combo_parada_arrasto.png");
  await expect(choices.filter({ hasText: "Martelo break" }).getByRole("img")).toHaveAttribute("src", "/hand-signals/martelo-break.webp");

  const names = page.getByRole("checkbox", { name: "Show rhythm names", exact: true });
  const notes = page.getByRole("checkbox", { name: "Show notes", exact: true });
  await names.uncheck();
  await notes.uncheck();
  await expect(choices.locator("strong")).toHaveText(titles);
  await expect(choices.getByRole("img")).toHaveCount(11);
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  await expect(choices.locator("strong")).toHaveText(titles);
  await sequence.check();
  await expect(page.locator(".radio-selection input:checked")).toHaveCount(1);
  await sequence.uncheck();
  await expect(sequence).toBeVisible();
  await sequence.focus();
  await sequence.press("Space");
  await expect(sequence).toBeChecked();
  await page.locator(".radio-settings").screenshot({ path: testInfo.outputPath("radio-options-names-and-gestures.png") });

  await prepare(page);
  const source = await audio.getAttribute("src");
  await expect(page.getByRole("button", { name: "Skip", exact: true })).toBeDisabled();
  await expect(page.locator(".radio-now h2")).toHaveText("Rhythm names hidden");
  await expect(page.locator(".radio-pattern")).toHaveCount(0);
  await expect(sequenceCard.locator("strong")).toHaveText("Parada + Arrasto");
  await expect(sequenceCard.getByRole("img")).toBeVisible();
  await names.check();
  await expect(page.locator(".radio-now h2")).toHaveText("Parada + Arrasto");
  await expect(audio).toHaveAttribute("src", source!);
  await names.uncheck();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(choices.locator("strong")).toHaveText(titles);
  expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) <= innerWidth + 1)).toBe(true);

  await page.reload();
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await expect(sequence).toBeChecked();
  await expect(page.locator(".radio-selection input:checked")).toHaveCount(1);
  await expect(names).not.toBeChecked();
  await expect(notes).not.toBeChecked();
  await expect(choices.locator("strong")).toHaveText(titles);
  await expect(sequenceCard.getByRole("img")).toBeVisible();
  expect(await audio.getAttribute("src")).toBeNull();
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  await expect(page.locator(".radio-selection input:not(:checked)")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("radio still loads when preference storage is unavailable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key.startsWith("baque-facil-"))
        throw new DOMException("Unavailable", "SecurityError");
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("baque-facil-"))
        throw new DOMException("Unavailable", "SecurityError");
      setItem.call(this, key, value);
    };
  });
  await page.goto("/radio/");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});

test("twenty-minute mix is generated as a compact MP3 with native playback", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chrome",
    "One full-length encoding benchmark is sufficient.",
  );
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const audio = await openRadio(page, {
    ...preferences,
    minutes: 20,
    repetitions: 8,
  });
  const started = Date.now();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible({ timeout: 100_000 });
  const encodingSeconds = (Date.now() - started) / 1000;
  const measurement = await audio.evaluate(
    async (element: HTMLAudioElement) => {
      const blob = await (await fetch(element.src)).blob();
      return {
        bytes: blob.size,
        durationSeconds: element.duration,
        loop: element.loop,
        type: blob.type,
      };
    },
  );
  expect(measurement.bytes).toBeGreaterThan(18_000_000);
  expect(measurement.bytes).toBeLessThan(21_000_000);
  expect(measurement.durationSeconds).toBeGreaterThan(1150);
  expect(measurement.durationSeconds).toBeLessThan(1250);
  expect(measurement.loop).toBe(true);
  expect(measurement.type).toBe("audio/mpeg");
  expect(errors).toEqual([]);
  await testInfo.attach("radio-generation-benchmark", {
    body: JSON.stringify({ ...measurement, encodingSeconds }, null, 2),
    contentType: "application/json",
  });
});

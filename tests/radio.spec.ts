import { expect, test, type Page } from "@playwright/test";

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
}

test("radio plays, pauses, seeks, loops natively while hidden, and restores its visible grid", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const audio = await openRadio(page);
  expect(await audio.getAttribute("src")).toBeNull();
  await prepare(page);
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.currentTime),
    )
    .toBeGreaterThan(0.1);
  const title = page.locator(".radio-now h2");
  const firstTitle = await title.textContent();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const pausedTime = await audio.evaluate(
    (element: HTMLAudioElement) => element.currentTime,
  );
  expect(pausedTime).toBeGreaterThan(0);
  expect(
    await audio.evaluate((element: HTMLAudioElement) => element.paused),
  ).toBe(true);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(title).not.toHaveText(firstTitle!);
  expect(
    await audio.evaluate((element: HTMLAudioElement) => element.paused),
  ).toBe(true);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const source = await audio.getAttribute("src");
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
  await page
    .getByRole("button", { name: "Stay on this rhythm", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Back to mix", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
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
  await page.getByRole("button", { name: "Back to mix", exact: true }).click();
  await expect(audio).toHaveAttribute("src", original!);
  await expect(page.locator(".radio-now h2")).not.toHaveText(heldTitle!);
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

test("preferences, optional combos, and keyboard controls work without autoplay on reload", async ({
  page,
}) => {
  const audio = await openRadio(page);
  await page
    .getByRole("checkbox", { name: "Include combos", exact: true })
    .check();
  await expect(page.getByRole("checkbox", { name: /Entrada/ })).toBeChecked();
  await page
    .getByRole("checkbox", { name: "Include combos", exact: true })
    .uncheck();
  await expect(page.getByRole("checkbox", { name: /Entrada/ })).toHaveCount(0);
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

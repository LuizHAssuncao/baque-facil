import { expect, test, type Locator } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("baque-facil-language", "en-CA"));
});

const longRhythm = "combo_three_crossed_break";

async function expectCellInView(grid: Locator, selector: string) {
  await expect.poll(() => grid.evaluate((container, cellSelector) => {
    const cell = container.querySelector(cellSelector);
    if (!cell) return false;
    const bounds = container.getBoundingClientRect();
    const rect = cell.getBoundingClientRect();
    return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
  }, selector)).toBe(true);
}

for (const surface of ["lesson", "composer", "radio"] as const) {
  test(`${surface} labels scroll with the notes and return when scrolling back`, async ({ page }, testInfo) => {
    if (surface === "radio") {
      await page.addInitScript((slug) => {
        localStorage.setItem("baque-facil-radio-v1", JSON.stringify({
          slugs: [slug], tempo: 120, repetitions: 4, minutes: 2,
        }));
      }, longRhythm);
    }
    await page.goto(surface === "radio" ? "/radio/" : `/${surface === "lesson" ? "rhythms" : "compose"}/${longRhythm}/`);
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    if (surface === "radio") {
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await page.getByRole("button", { name: "Pause", exact: true }).click({ timeout: 25_000 });
    }

    const grid = page.locator(".grid-scroll");
    await expect(grid).toBeVisible();
    const measurements = await grid.evaluate((container) => {
      const labels = Array.from(container.querySelectorAll(".track-name"));
      const cells = Array.from(container.querySelectorAll(".grid-row .step-cell:nth-child(2)"));
      container.scrollLeft = 0;
      const before = [...labels, ...cells].map((element) => element.getBoundingClientRect().left);
      container.scrollLeft = 240;
      return {
        scrolled: container.scrollLeft,
        movements: [...labels, ...cells].map((element, index) => before[index] - element.getBoundingClientRect().left),
        labelsHidden: labels.every((element) => element.getBoundingClientRect().right <= container.getBoundingClientRect().left),
        cellLefts: cells.map((element) => element.getBoundingClientRect().left),
      };
    });
    expect(measurements.scrolled).toBe(240);
    for (const movement of measurements.movements) expect(movement).toBeCloseTo(measurements.scrolled, 0);
    expect(measurements.labelsHidden).toBe(true);
    expect(Math.max(...measurements.cellLefts) - Math.min(...measurements.cellLefts)).toBeLessThan(1);
    await grid.screenshot({ path: testInfo.outputPath(`${surface}-scrolled.png`) });

    await grid.evaluate((container) => { container.scrollLeft = 0; });
    await expectCellInView(grid, ".grid-row:not(.count-row) .track-name");
    if (surface !== "radio") {
      await page.getByRole("button", { name: "Mute Alfaia", exact: true }).click();
      await expect(page.getByRole("button", { name: "Unmute Alfaia", exact: true })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Unmute Alfaia", exact: true }).click();
    } else {
      // Seeking both directions must bring the radio playhead back into view.
      await page.getByRole("button", { name: "Play", exact: true }).click();
      const audio = page.locator("audio[data-radio-player]");
      await audio.evaluate((element: HTMLAudioElement) => { element.currentTime = 15; });
      await expect.poll(() => grid.evaluate((container) => container.scrollLeft)).toBeGreaterThan(240);
      await expectCellInView(grid, ".count-cell.active");
      await audio.evaluate((element: HTMLAudioElement) => { element.currentTime = 0; });
      await expect.poll(() => grid.evaluate((container) => container.scrollLeft)).toBeLessThan(240);
      await expectCellInView(grid, ".count-cell.active");
      await page.getByRole("button", { name: "Pause", exact: true }).click();
    }
    expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) <= innerWidth + 1)).toBe(true);
  });
}

for (const route of ["rhythms", "compose"]) {
  test(`${route} playback follows notes across the full scrolling viewport`, async ({ page }) => {
    await page.goto(`/${route}/${longRhythm}/`);
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    await page.getByRole("slider", { name: "Tempo", exact: true }).fill("120");
    const grid = page.locator(".grid-scroll");
    const active = route === "compose" ? ".count-cell.playhead" : ".count-cell.active";
    await grid.evaluate((container) => { container.scrollLeft = container.scrollWidth; });
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(() => grid.evaluate((container) => container.scrollLeft)).toBeLessThan(240);
    await expectCellInView(grid, active);
    await expect.poll(() => grid.evaluate((container) => container.scrollLeft), { timeout: 15_000 }).toBeGreaterThan(240);
    await expectCellInView(grid, active);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
  });
}

test("composer beat navigation and keyboard selection work after labels scroll away", async ({ page }) => {
  await page.goto(`/compose/${longRhythm}/`);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  const grid = page.locator(".grid-scroll");
  const next = page.getByRole("button", { name: "Next beat", exact: true });
  const previous = page.getByRole("button", { name: "Previous beat", exact: true });
  const beatStatus = page.locator(".composer-grid-navigation");
  await expect(previous).toBeDisabled();
  for (const beat of [2, 3, 4]) {
    await next.click();
    await expect(beatStatus).toContainText(`Beat ${beat} of 39`);
    // The chosen beat starts near the left edge, without reserving label space.
    await expect.poll(() => grid.evaluate((container, step) => {
      const cell = container.querySelector(`[data-count="${step}"]`)!;
      const left = cell.getBoundingClientRect().left - container.getBoundingClientRect().left;
      return left >= 0 && left < 24;
    }, (beat - 1) * 4)).toBe(true);
  }
  for (const beat of [3, 2, 1]) {
    await previous.click();
    await expect(beatStatus).toContainText(`Beat ${beat} of 39`);
  }
  await expect.poll(() => grid.evaluate((container) => container.scrollLeft)).toBe(0);
  await expect(previous).toBeDisabled();
  await expectCellInView(grid, ".composer-note-row .track-name");

  const first = grid.locator('[data-note="0-0"]');
  await first.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(grid.locator('[data-note="0-152"]')).toBeFocused();
  await expectCellInView(grid, '[data-note="0-152"]');
  await page.keyboard.press("ArrowRight");
  await expect(first).toBeFocused();
  await expectCellInView(grid, '[data-note="0-0"]');
});

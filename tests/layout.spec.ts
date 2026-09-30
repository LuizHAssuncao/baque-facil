import { expect, test, type Page, type TestInfo } from "@playwright/test";

const routes = [
  { name: "home", path: "/", heading: "Baque Fácil" },
  { name: "compose", path: "/compose/", heading: "Alfaia Composer" },
  { name: "ios-audio-help", path: "/help/ios-audio/", heading: "Can't hear sound?" },
  { name: "rhythm-marcacao", path: "/rhythms/marcacao/", heading: "1 - Marcação" },
  { name: "rhythm-combo-entrada", path: "/rhythms/combo_entrada/", heading: "Entrada" },
  { name: "rhythm-combo", path: "/rhythms/combo_parada_arrasto/", heading: "Parada + Arrasto" },
  { name: "customize-marcacao", path: "/compose/marcacao/", heading: "Alfaia Composer" },
  {
    name: "customize-multitrack",
    path: "/compose/combo_three_crossed_break/",
    heading: "Alfaia Composer",
  },
];

const marcacaoRhythmBlock = [
  "Alfaia:",
  "R . . . | . . . . | L R . . | L R . .",
].join("\n");

async function collectRuntimeErrors(page: Page) {
  const runtimeErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });

  page.on("pageerror", (error) => {
    runtimeErrors.push(error.message);
  });

  return runtimeErrors;
}

async function expectNoBodyOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const documentWidth = document.documentElement.clientWidth;
    const bodyWidth = document.body.scrollWidth;
    const rootWidth = document.documentElement.scrollWidth;

    return Math.max(bodyWidth, rootWidth) - documentWidth;
  });

  expect(overflow).toBeLessThanOrEqual(1);
}

async function screenshotLayout(page: Page, testInfo: TestInfo, routeName: string) {
  const fileName = `${testInfo.project.name}-${routeName}.png`;

  await page.screenshot({
    path: testInfo.outputPath(fileName),
    fullPage: true,
  });
}

async function grantClipboardPermissions(page: Page) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });
}

for (const route of routes) {
  test(`${route.name} renders without layout overflow`, async ({ page }, testInfo) => {
    const runtimeErrors = await collectRuntimeErrors(page);

    await page.goto(route.path);
    await expect(page.getByRole("heading", { name: route.heading, level: 1 })).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    await expectNoBodyOverflow(page);
    await screenshotLayout(page, testInfo, route.name);

    expect(runtimeErrors).toEqual([]);
  });
}

test("predefined rhythm player copies transcription", async ({ page }) => {
  await page.goto("/rhythms/marcacao/");
  await grantClipboardPermissions(page);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);

  await page.getByRole("button", { name: "Copy transcription" }).click();

  await expect(page.locator(".player-status")).toHaveText("Copied transcription.");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
    marcacaoRhythmBlock,
  );
});

test("built-in rhythm notes stay read-only while playback controls remain available", async ({ page }) => {
  await page.goto("/rhythms/marcacao/");
  await grantClipboardPermissions(page);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);

  const player = page.locator(".player-panel");
  const firstStep = player.locator(".grid-row:not(.count-row) .step-cell").first();

  await expect(player.locator("button.step-cell")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset pattern" })).toHaveCount(0);
  await expect(firstStep).toHaveText("R");
  await firstStep.click();
  await expect(firstStep).toHaveText("R");
  await page.getByRole("button", { name: "Disable loop" }).click();
  await expect(page.getByRole("button", { name: "Enable loop" })).toBeVisible();
  await page.keyboard.press("+");
  await expect(page.getByRole("slider", { name: "Tempo" })).toHaveValue("91");

  await page.getByRole("button", { name: "Copy transcription" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
    marcacaoRhythmBlock,
  );
});

test("Customize opens an editable copy and reset restores its starting rhythm", async ({ page }) => {
  const runtimeErrors = await collectRuntimeErrors(page);
  await page.goto("/rhythms/marcacao/");
  await page.getByRole("link", { name: "Customize", exact: true }).click();
  await expect(page).toHaveURL("/compose/marcacao/");
  await expect(page.getByRole("heading", { name: "Alfaia Composer", level: 1 })).toBeVisible();
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);

  const transcription = page.getByRole("textbox", { name: "Transcription" });
  await expect(transcription).toHaveValue(/title: "1 - Marcação"/);
  await expect(transcription).toHaveValue(/tempo: 90\nsubdivision: 16/);
  expect(await transcription.inputValue()).toContain(marcacaoRhythmBlock);
  await expect(page.getByRole("slider", { name: "Tempo" })).toHaveCount(2);
  for (const slider of await page.getByRole("slider", { name: "Tempo" }).all()) {
    await expect(slider).toHaveValue("90");
  }
  await expect(page.getByRole("button", { name: "Step 1: R", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset pattern" })).toHaveCount(0);

  for (const [before, after] of [["R", "B"], ["B", "."], [".", "L"], ["L", "R"]]) {
    await page.getByRole("button", { name: `Alfaia step 1: ${before}`, exact: true }).click();
    await expect(page.getByRole("button", { name: `Alfaia step 1: ${after}`, exact: true })).toBeVisible();
  }

  await page.getByRole("button", { name: "Alfaia step 1: R", exact: true }).click();
  await expect(transcription).toHaveValue(/Alfaia:\nB \. \. \./);
  await page.getByRole("button", { name: "Reset pattern" }).click();
  await expect(page.getByRole("button", { name: "Alfaia step 1: R", exact: true })).toBeVisible();
  await expect(transcription).toHaveValue(/Alfaia:\nR \. \. \./);
  await expect(page.getByRole("button", { name: "Reset pattern" })).toHaveCount(0);

  await page.reload();
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Alfaia step 1: R", exact: true })).toBeVisible();
  await expect(transcription).toHaveValue(/title: "1 - Marcação"/);
  await page.getByRole("button", { name: "Alfaia step 1: R", exact: true }).click();
  await expect(page.getByRole("button", { name: "Alfaia step 1: B", exact: true })).toBeVisible();

  await page.goto("/rhythms/marcacao/");
  await grantClipboardPermissions(page);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.getByRole("button", { name: "Copy transcription" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(marcacaoRhythmBlock);
  await expect(page.locator(".player-panel button.step-cell")).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});

test("Customize preserves every track, long patterns, and the source tempo", async ({ page }) => {
  const runtimeErrors = await collectRuntimeErrors(page);
  await page.goto("/rhythms/combo_three_crossed_break/");
  await page.getByRole("link", { name: "Customize", exact: true }).click();
  await expect(page).toHaveURL("/compose/combo_three_crossed_break/");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);

  const transcription = page.getByRole("textbox", { name: "Transcription" });
  await expect(transcription).toHaveValue(/title: "Three Crossed Break"/);
  await expect(transcription).toHaveValue(/tempo: 95\nsubdivision: 16/);
  await expect(transcription).toHaveValue(/instruments:\n  - "Alfaia"\n  - "Caixa"/);
  await expect(page.locator(".composer-step-row button")).toHaveCount(153);
  await expect(page.locator(".player-panel button.step-cell")).toHaveCount(306);
  await expect(page.getByRole("button", { name: "Alfaia step 3: R", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Caixa step 1: X", exact: true }).click();
  await expect(page.getByRole("button", { name: "Caixa step 1: .", exact: true })).toBeVisible();
  await expect(transcription).toHaveValue(/Caixa:\n\. \. \. \./);
  await expect(page.getByRole("button", { name: "Alfaia step 3: R", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reset pattern" }).click();
  await expect(page.getByRole("button", { name: "Caixa step 1: X", exact: true })).toBeVisible();
  await expectNoBodyOverflow(page);
  expect(runtimeErrors).toEqual([]);
});

test("composer edits preview pattern without changing recorded grid", async ({ page }) => {
  await page.goto("/compose/");

  const transcription = page.getByRole("textbox", { name: "Transcription" });
  const recordedStep = page.getByRole("button", { name: "Step 1: .", exact: true });

  await transcription.fill("Alfaia:\nL . . . | . . . . | . . . . | . . . .\n");
  await expect(page.getByRole("button", { name: "Alfaia step 1: L" })).toBeVisible();
  await expect(recordedStep).toHaveText(".");

  await page.getByRole("button", { name: "Alfaia step 1: L" }).click();
  await expect(page.getByRole("button", { name: "Alfaia step 1: R" })).toBeVisible();
  await expect(transcription).toHaveValue(/R \. \. \./);
  await expect(recordedStep).toHaveText(".");

  await transcription.fill("Alfaia:\nB . . . | . . . . | . . . . | . . . .\n");
  await expect(page.getByRole("button", { name: "Alfaia step 1: B" })).toBeVisible();
  await expect(page.getByRole("alert")).toBeHidden();
  await expect(recordedStep).toHaveText(".");

  await transcription.fill("Alfaia:\nQ\n");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Alfaia step 1: B" })).toBeVisible();

  await page.getByRole("button", { name: "Reset pattern" }).click();
  await expect(page.getByRole("alert")).toBeHidden();
  await expect(page.getByRole("button", { name: "Alfaia step 1: ." })).toBeVisible();
  await expect(recordedStep).toHaveText(".");
});

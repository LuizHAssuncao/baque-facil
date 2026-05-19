import { expect, test, type Page, type TestInfo } from "@playwright/test";

const routes = [
  { name: "home", path: "/", heading: "Baque Fácil" },
  { name: "compose", path: "/compose/", heading: "Alfaia Composer" },
  { name: "ios-audio-help", path: "/help/ios-audio/", heading: "Can't hear sound?" },
  { name: "rhythm-marcacao", path: "/rhythms/marcacao/", heading: "Marcação" },
  { name: "rhythm-combo1", path: "/rhythms/combo1/", heading: "Combo 1" },
];

const marcacaoRhythmBlock = [
  "Gongue:",
  ". X . . | X . X . | . X . . | X . X .",
  "",
  "Alfaia:",
  ". . . . | . . L R | . . L R | . . R .",
].join("\n");

const marcacaoWithEditedAlfaiaStep = [
  "Gongue:",
  ". X . . | X . X . | . X . . | X . X .",
  "",
  "Alfaia:",
  ". . . . | . . R R | . . L R | . . R .",
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
    await expectNoBodyOverflow(page);
    await screenshotLayout(page, testInfo, route.name);

    expect(runtimeErrors).toEqual([]);
  });
}

test("predefined rhythm player copies transcription", async ({ page }) => {
  await page.goto("/rhythms/marcacao/");
  await grantClipboardPermissions(page);

  await page.getByRole("button", { name: "Copy transcription" }).click();

  await expect(page.locator(".player-status")).toHaveText("Copied transcription.");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
    marcacaoRhythmBlock,
  );
});

test("predefined rhythm player notes cycle and reset", async ({ page }) => {
  await page.goto("/rhythms/marcacao/");
  await grantClipboardPermissions(page);

  const gongueStep = page.getByRole("button", { name: "Gongue step 2: X" });

  await gongueStep.click();
  await expect(page.getByRole("button", { name: "Gongue step 2: ." })).toBeVisible();

  const resetButton = page.getByRole("button", { name: "Reset pattern" });

  await expect(resetButton).toBeVisible();
  await resetButton.click();
  await expect(page.getByRole("button", { name: "Gongue step 2: X" })).toBeVisible();
  await expect(resetButton).toBeHidden();

  await page.getByRole("button", { name: "Alfaia step 7: L" }).click();
  await expect(page.getByRole("button", { name: "Alfaia step 7: R" })).toBeVisible();
  await page.getByRole("button", { name: "Copy transcription" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
    marcacaoWithEditedAlfaiaStep,
  );

  await page.getByRole("button", { name: "Alfaia step 7: R" }).click();
  await expect(page.getByRole("button", { name: "Alfaia step 7: ." })).toBeVisible();

  await page.getByRole("button", { name: "Alfaia step 7: ." }).click();
  await expect(page.getByRole("button", { name: "Alfaia step 7: L" })).toBeVisible();
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

  await transcription.fill("Alfaia:\nQ\n");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Alfaia step 1: R" })).toBeVisible();

  await page.getByRole("button", { name: "Reset pattern" }).click();
  await expect(page.getByRole("alert")).toBeHidden();
  await expect(page.getByRole("button", { name: "Alfaia step 1: ." })).toBeVisible();
  await expect(recordedStep).toHaveText(".");
});

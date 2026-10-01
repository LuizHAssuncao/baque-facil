import { expect, test, type Page } from "@playwright/test";

// Exercise the real React islands, parser, sample loading and preview through the UI.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("baque-facil-language", "en-CA"));
});

async function openComposer(page: Page, path = "/compose/") {
  await page.goto(path);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
}

const transcription = (page: Page) => page.getByRole("textbox", { name: "Transcription" });
const previewNotes = (page: Page) => page.locator(".player-panel .grid-row:not(.count-row) .step-cell");

test("recording commits timed hits and rests, and reset restores the completed take", async ({ page, isMobile }) => {
  await openComposer(page);
  await page.getByRole("slider", { name: "Tempo", exact: true }).first().fill("120");
  // Control only browser time: input events, recording logic and audio remain real.
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.locator(".count-in")).toHaveText("1");
  await page.clock.runFor(1500);
  await expect(page.locator(".composer-actions")).toContainText("Recording");
  const left = page.getByRole("button", { name: "Press F key Left", exact: true });
  const right = page.getByRole("button", { name: "Press J key Right", exact: true });
  if (isMobile) await left.tap();
  else await left.click();
  await expect(page.getByRole("button", { name: "Step 1: L", exact: true })).toBeVisible();
  // At 120 BPM and subdivision 16, each step is 125 ms. Leave step 2 silent.
  await page.clock.runFor(250);
  if (isMobile) await right.tap();
  else await right.click();
  await expect(page.getByRole("button", { name: "Step 3: R", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  await expect(page.locator(".composer-step-row button")).toHaveText(["L", ".", "R"]);
  await expect(previewNotes(page)).toHaveText(["L", ".", "R"]);
  await expect(transcription(page)).toHaveValue(/Alfaia:\nL \. R/);
  const take = await transcription(page).inputValue();
  await page.clock.resume();
  await page.getByRole("button", { name: "Alfaia step 1: L", exact: true }).click();
  await expect(transcription(page)).not.toHaveValue(take);
  await page.getByRole("button", { name: "Reset pattern", exact: true }).click();
  await expect(transcription(page)).toHaveValue(take);
  await expect(previewNotes(page)).toHaveText(["L", ".", "R"]);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

test("canceling count-in preserves unsaved multitrack edits and does not start a delayed take", async ({ page }) => {
  await openComposer(page, "/compose/combo_three_crossed_break/");
  await page.getByRole("button", { name: "Caixa step 1: X", exact: true }).click();
  const edited = await transcription(page).inputValue();
  const notes = await previewNotes(page).allTextContents();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.locator(".count-in")).toHaveText("1");
  await page.getByRole("button", { name: "Press F key Left", exact: true }).click();
  await expect(transcription(page)).toHaveValue(edited);
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  await page.clock.runFor(5000);
  await expect(page.locator(".composer-actions")).toContainText("Count-in canceled");
  await expect(page.getByRole("button", { name: "Record", exact: true })).toBeEnabled();
  await expect(page.locator(".count-in")).toHaveCount(0);
  await expect(transcription(page)).toHaveValue(edited);
  await expect(previewNotes(page)).toHaveText(notes);
  await expect(page.locator(".composer-step-row button")).toHaveCount(153);
  await page.clock.resume();
  await page.getByRole("button", { name: "Reset pattern", exact: true }).click();
  await expect(page.getByRole("button", { name: "Caixa step 1: X", exact: true })).toBeVisible();
});

test("keyboard composes and erases notes but typing transcription never triggers destructive shortcuts", async ({ page }) => {
  await openComposer(page);
  await page.getByRole("button", { name: "Step 1: .", exact: true }).click();
  await page.keyboard.press("f");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("j");
  await expect(transcription(page)).toHaveValue(/Alfaia:\nL R/);
  await page.keyboard.press("Backspace");
  await expect(transcription(page)).toHaveValue(/Alfaia:\nL \./);
  const tempo = await page.getByRole("slider", { name: "Tempo", exact: true }).first().inputValue();
  // A valid Markdown title can contain every dangerous shortcut character.
  const original = await transcription(page).inputValue();
  await transcription(page).focus();
  await page.keyboard.press("Control+Home");
  const prefix = "title: f j r m l c + - ";
  await page.keyboard.type(prefix);
  await page.keyboard.press("Enter");
  await expect(transcription(page)).toHaveValue(`${prefix}\n${original}`);
  await expect(page.getByRole("button", { name: "Record", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn metronome on", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disable loop", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Tempo", exact: true }).first()).toHaveValue(tempo);
  await expect(page.getByRole("button", { name: "Alfaia step 1: L", exact: true })).toBeVisible();
});

test("left-handed mode survives navigation and reload without changing copied or customized notation", async ({ page, context }) => {
  await page.goto("/");
  await page.locator("#settings summary").click();
  await page.getByRole("checkbox", { name: /Left-handed mode/ }).check();
  await page.goto("/rhythms/marcacao/");
  await expect(previewNotes(page).first()).toHaveText("L");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy transcription", exact: true }).click();
  const canonical = "Alfaia:\nR . . . | . . . . | L R . . | L R . .";
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(canonical);
  await page.reload();
  await expect(previewNotes(page).first()).toHaveText("L");
  await page.getByRole("link", { name: "Customize", exact: true }).click();
  await expect(transcription(page)).toHaveValue(/Alfaia:\nR \. \. \./);
  await expect(page.getByRole("button", { name: "Alfaia step 1: L", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Alfaia step 1: L", exact: true }).click();
  await expect(transcription(page)).toHaveValue(/Alfaia:\nB \. \. \./);
  await page.getByRole("button", { name: "Reset pattern", exact: true }).click();
  expect(await transcription(page).inputValue()).toContain(canonical);
  await expect(previewNotes(page).first()).toHaveText("L");
  await page.goto("/");
  await page.locator("#settings summary").click();
  await expect(page.getByRole("checkbox", { name: /Left-handed mode/ })).toBeChecked();
  await page.getByRole("checkbox", { name: /Left-handed mode/ }).uncheck();
  await page.goto("/rhythms/marcacao/");
  await expect(previewNotes(page).first()).toHaveText("R");
});

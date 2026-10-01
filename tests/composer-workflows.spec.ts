import { expect, test, type Page } from "@playwright/test";
import { chooseNote, openPads, openTranscription, resetTake } from "./composer-helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("baque-facil-language", "en-CA"));
});

async function openComposer(page: Page, path = "/compose/") {
  await page.goto(path);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
}
const notes = (page: Page) => page.locator(".composer-note-row .step-cell");

test("one grid supports explicit notes, undo, redo, example, tempo and draft recovery", async ({ page }) => {
  await openComposer(page);
  await expect(page.locator(".rhythm-grid")).toHaveCount(1);
  await expect(page.getByRole("slider", { name: "Tempo", exact: true })).toHaveCount(1);
  await expect(page.locator(".composer-transcription textarea")).toBeHidden();
  await expect(page.getByText("Tap a space to add a hit.")).toBeVisible();
  await chooseNote(page, "Alfaia step 1: .", "Border");
  await expect(page.getByText("Tap a space to add a hit.")).toBeHidden();
  await expect(page.getByRole("button", { name: "Alfaia step 1: B", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Alfaia step 1: .", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.getByRole("slider", { name: "Tempo", exact: true }).fill("110");
  await page.getByRole("button", { name: "Rename rhythm", exact: true }).click();
  await page.getByRole("textbox", { name: "Rhythm name", exact: true }).fill("My border groove");
  await page.getByRole("textbox", { name: "Rhythm name", exact: true }).press("Enter");
  await expect(page.getByText("Saved on this device", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "My border groove" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Tempo", exact: true })).toHaveValue("110");
  await expect(page.getByRole("button", { name: "Alfaia step 1: B", exact: true })).toBeVisible();
  const transcription = await openTranscription(page);
  await expect(transcription).toHaveValue(/title: "My border groove"/);
  await expect(transcription).toHaveValue(/tempo: 110/);
  await page.getByRole("button", { name: "Use an example", exact: true }).click();
  await expect(page.getByRole("heading", { name: "1 - Marcação", exact: true })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Tempo", exact: true })).toHaveValue("90");
  await expect(transcription).toHaveValue(/Alfaia:\nR \. \. \. \| \. \. \. \. \| L R \. \. \| L R \. \./);
  await expect(notes(page)).toHaveText(["R", "·", "·", "·", "·", "·", "·", "·", "L", "R", "·", "·", "L", "R", "·", "·"]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(transcription).toHaveValue(/Alfaia:\nB \. \. \./);
  await expect(page.getByRole("heading", { name: "My border groove", exact: true })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Tempo", exact: true })).toHaveValue("110");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "1 - Marcação", exact: true })).toBeVisible();
  await expect(page.getByText("Saved on this device", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "1 - Marcação", exact: true })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Tempo", exact: true })).toHaveValue("90");
});

test("recording captures Left, Right, Border and gaps; the previous composition is undoable", async ({ page, isMobile }) => {
  await openComposer(page);
  await chooseNote(page, "Alfaia step 1: .", "Right");
  const transcription = await openTranscription(page);
  const previous = await transcription.inputValue();
  await page.getByRole("slider", { name: "Tempo", exact: true }).fill("120");
  await openPads(page);
  // Idle pads audition only; they never silently edit the selected step.
  await page.getByRole("button", { name: "Border hit", exact: true }).click();
  await expect(page.getByRole("button", { name: "Alfaia step 1: R", exact: true })).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.locator(".count-in strong")).toHaveText("1");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  await expect(transcription).toBeDisabled();
  await page.clock.runFor(1500);
  await expect(page.locator(".recording-status")).toContainText("Recording");
  for (const [label, delay] of [["Left hit", 250], ["Right hit", 125], ["Border hit", 0]] as const) {
    const pad = page.getByRole("button", { name: label, exact: true });
    if (isMobile) await pad.tap(); else await pad.click();
    if (delay) await page.clock.runFor(delay);
  }
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  await expect(notes(page)).toHaveText(["L", "·", "R", "B"]);
  await expect(transcription).toHaveValue(/Alfaia:\nL \. R B/);
  await page.clock.resume();
  const take = await transcription.inputValue();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await transcription.inputValue()).replace("tempo: 120", "tempo: 90")).toBe(previous);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(transcription).toHaveValue(take);
  await chooseNote(page, "Alfaia step 1: L", "Border");
  await resetTake(page);
  await expect(transcription).toHaveValue(take);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

test("canceling count-in preserves every multitrack edit and recording keeps other instruments", async ({ page }) => {
  await openComposer(page, "/compose/combo_three_crossed_break/");
  await chooseNote(page, "Caixa step 1: X", "Rest");
  const transcription = await openTranscription(page);
  const edited = await transcription.inputValue();
  await page.getByRole("slider", { name: "Tempo", exact: true }).fill("120");
  await openPads(page);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.getByRole("button", { name: "Border hit", exact: true }).click();
  await page.getByRole("button", { name: "Cancel count-in", exact: true }).click();
  await page.clock.runFor(5000);
  await expect(page.locator(".count-in")).toHaveCount(0);
  expect((await transcription.inputValue()).replace("tempo: 120", "tempo: 95")).toBe(edited);
  await expect(notes(page)).toHaveCount(306);
  const caixa = (await transcription.inputValue()).split("Caixa:")[1];
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.clock.runFor(1500);
  await page.getByRole("button", { name: "Border hit", exact: true }).click();
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  expect((await transcription.inputValue()).split("Caixa:")[1]).toBe(caixa);
  await expect(notes(page)).toHaveCount(306);
  await expect(page.getByRole("button", { name: "Alfaia step 1: B", exact: true })).toBeVisible();
});

test("keyboard editing, picker focus and shortcuts respect text entry", async ({ page }) => {
  await openComposer(page);
  const first = page.getByRole("button", { name: "Alfaia step 1: .", exact: true });
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Change hit" })).toBeVisible();
  await page.keyboard.press("r");
  await expect(page.locator(".count-in")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(first).toBeFocused();
  await page.keyboard.press("f");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("b");
  await expect(page.getByRole("button", { name: "Alfaia step 2: B", exact: true })).toBeVisible();
  await page.keyboard.press("Backspace");
  await expect(page.getByRole("button", { name: "Alfaia step 2: .", exact: true })).toBeVisible();
  const transcription = await openTranscription(page);
  const original = await transcription.inputValue();
  await transcription.fill(`title: f j b r m l c + -\n${original}`);
  await expect(page.locator(".count-in")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Alfaia step 1: L", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
});

test("left-handed display preserves canonical notation in the explicit picker", async ({ page, context }) => {
  await page.addInitScript(() => localStorage.setItem("baque-facil-reverse-hand-symbols", "true"));
  await openComposer(page, "/compose/marcacao/");
  const transcription = await openTranscription(page);
  await expect(transcription).toHaveValue(/Alfaia:\nR \. \. \./);
  await chooseNote(page, "Alfaia step 1: L", "Border");
  await expect(transcription).toHaveValue(/Alfaia:\nB \. \. \./);
  await chooseNote(page, "Alfaia step 1: B", "Left");
  await expect(transcription).toHaveValue(/Alfaia:\nR \. \. \./);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy transcription", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("Alfaia:\nR . . .");
});

test("invalid transcriptions recover after reload and storage failures never claim a saved draft", async ({ page, context }) => {
  await openComposer(page);
  await chooseNote(page, "Alfaia step 1: .", "Left");
  const transcription = await openTranscription(page);
  await transcription.fill("Alfaia:\nQ");
  await expect(page.getByRole("alert")).toContainText("last valid transcription");
  await expect(page.getByText("Saved on this device", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Alfaia step 1: L", exact: true })).toBeVisible();
  await expect(await openTranscription(page)).toHaveValue("Alfaia:\nQ");
  const blocked = await context.newPage();
  await blocked.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException("Storage blocked", "QuotaExceededError"); }; });
  await blocked.goto("/compose/marcacao/");
  await expect(blocked.getByText("Changes could not be saved on this device.", { exact: true })).toBeVisible();
  await expect(blocked.getByText("Saved on this device", { exact: true })).toHaveCount(0);
});

test("a malformed stored draft is ignored and beat growth remains editable", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("baque-facil-composer-draft:new", '{"version":1,"tracks":null}'));
  await openComposer(page);
  await page.getByRole("button", { name: "Add beat", exact: true }).click();
  await expect(notes(page)).toHaveCount(20);
  await chooseNote(page, "Alfaia step 20: .", "Border");
  await expect(page.getByRole("button", { name: "Alfaia step 20: B", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("adding Alfaia by keyboard preserves a longer rhythm containing only another instrument", async ({ page }) => {
  await openComposer(page);
  const transcription = await openTranscription(page);
  await transcription.fill(`Gongue:\n${Array.from({ length: 24 }, (_, index) => index % 4 === 0 ? "X" : ".").join(" ")}`);
  await chooseNote(page, "Gongue step 20: .", "Rest");
  await page.keyboard.press("f");
  await expect(notes(page)).toHaveCount(48);
  await expect(page.getByRole("button", { name: "Gongue step 24: .", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Alfaia step 20: L", exact: true })).toBeVisible();
});

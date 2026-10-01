import { expect, test, type Page } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { chooseNote, openPads, openTranscription, resetTake } from "./composer-helpers";
import { parseRhythm } from "../src/lib/parseRhythm";
import { extractRhythmBlock } from "../src/lib/extractRhythmBlock";
import { createRhythmShareUrl, MAX_SHARE_URL_LENGTH, readRhythmShareUrl } from "../src/lib/shareRhythm";
import type { Rhythm } from "../src/lib/rhythmTypes";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("baque-facil-language", "en-CA"));
});

const linkField = (page: Page) => page.getByRole("textbox", { name: "Rhythm link", exact: true });
const notes = (page: Page) => page.locator(".composer-unified-grid .grid-row:not(.count-row) .step-cell");
async function rename(page: Page, name: string) {
  await page.getByRole("button", { name: "Rename rhythm", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Rhythm name", exact: true });
  await input.fill(name);
  await input.press("Enter");
}
async function share(page: Page) {
  await page.getByRole("button", { name: "Share rhythm", exact: true }).click();
  await expect(linkField(page)).toBeVisible();
  const url = await linkField(page).inputValue();
  expect(url.length).toBeLessThanOrEqual(MAX_SHARE_URL_LENGTH);
  expect(new URL(url).pathname).toBe("/compose/");
  return url;
}

test("compose, name, set tempo and share to a fresh browser; edits create independent snapshots", async ({ page, context, browser, isMobile }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/compose/");
  await chooseNote(page, "Alfaia step 1: .", "Left");
  await chooseNote(page, "Alfaia step 3: .", "Border");
  const name = 'Maré 🥁 "F J B R M L C + -" & <ritmo>';
  await rename(page, name);
  await page.getByRole("slider", { name: "Tempo", exact: true }).fill("113");
  const original = await (await openTranscription(page)).inputValue();
  expect(original).toContain("tempo: 113");
  expect(original).toContain('title: "Maré 🥁 \\"F J B R M L C + -\\" & <ritmo>"');
  const url = await share(page);
  await expect(page.getByText("Rhythm link copied.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  const payload = JSON.parse(Buffer.from(new URL(url).hash.slice(8), "base64url").toString("utf8"));
  expect(payload).toEqual({ v: 1, name, tempo: 113, subdivision: 16, tracks: [{ name: "Alfaia", steps: "L.B............." }] });

  const recipient = await browser.newContext({ viewport: page.viewportSize(), isMobile, hasTouch: isMobile });
  try {
    await recipient.addInitScript(() => localStorage.setItem("baque-facil-language", "en-CA"));
    const other = await recipient.newPage();
    other.on("pageerror", (error) => errors.push(error.message));
    await other.goto(url);
    await expect(other.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(other.getByRole("slider", { name: "Tempo", exact: true })).toHaveValue("113");
    await expect(await openTranscription(other)).toHaveValue(original);
    await expect(other.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
    await expect(other.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
    await other.getByRole("button", { name: "Play", exact: true }).click();
    await expect(other.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    await other.getByRole("button", { name: "Stop", exact: true }).click();
    await chooseNote(other, "Alfaia step 1: L", "Right");
    await resetTake(other);
    await expect(await openTranscription(other)).toHaveValue(original);
    await chooseNote(other, "Alfaia step 1: L", "Right");
    await rename(other, "Edited version");
    await other.getByRole("slider", { name: "Tempo", exact: true }).fill("80");
    const editedUrl = await share(other);
    expect(editedUrl).not.toBe(url);
    await other.reload();
    await expect(other.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(await openTranscription(other)).toHaveValue(original);
    await other.goto(editedUrl);
    await expect(other.getByRole("heading", { name: "Edited version", exact: true })).toBeVisible();
    await expect(other.getByRole("slider", { name: "Tempo", exact: true })).toHaveValue("80");
    await expect(other.getByRole("button", { name: "Alfaia step 1: R", exact: true })).toBeVisible();
    expect(await other.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await recipient.close(); }
  expect(errors).toEqual([]);
});

test("shared multitrack snapshots preserve local drafts, canonical hands, undo and original reset", async ({ page }) => {
  await page.goto("/compose/");
  await rename(page, "My local draft");
  await chooseNote(page, "Alfaia step 1: .", "Border");
  await expect(page.getByText("Saved on this device", { exact: true })).toBeVisible();
  const draft = await page.evaluate(() => localStorage.getItem("baque-facil-composer-draft:new"));
  await page.goto("/compose/combo_three_crossed_break/");
  await chooseNote(page, "Caixa step 1: X", "Rest");
  const originalNotes = await notes(page).allTextContents();
  const url = await share(page);
  await page.goto(url);
  await expect(notes(page)).toHaveText(originalNotes);
  await chooseNote(page, "Alfaia step 1: .", "Border");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(notes(page)).toHaveText(originalNotes);
  await page.evaluate(() => localStorage.setItem("baque-facil-reverse-hand-symbols", "true"));
  await page.reload();
  expect(await share(page)).toBe(url);
  expect(await page.evaluate(() => localStorage.getItem("baque-facil-composer-draft:new"))).toBe(draft);
  await page.goto("/compose/");
  await expect(page.getByRole("heading", { name: "My local draft", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Alfaia step 1: B", exact: true })).toBeVisible();
});

test("every existing rhythm fits and round-trips using compact steps", async ({ page }) => {
  test.setTimeout(60_000);
  for (const file of await readdir("src/content/rhythms")) {
    if (!file.endsWith(".md")) continue;
    const source = await readFile(`src/content/rhythms/${file}`, "utf8");
    const expected = parseRhythm(extractRhythmBlock(source)!);
    const slug = source.match(/^slug:\s*"?([^"\s]+)"?$/m)?.[1] ?? file.slice(0, -3);
    await page.goto(`/compose/${slug}/`);
    const url = await share(page);
    expect(readRhythmShareUrl(url)?.tracks, file).toEqual(expected);
  }
});

test("opening a shared hash immediately after editing flushes the pending local draft", async ({ page }) => {
  await page.goto("/compose/");
  await expect(page.getByText("Saved on this device", { exact: true })).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await rename(page, "Keep the latest edit");
  const url = createRhythmShareUrl({ title: "Incoming rhythm", slug: "test", tempo: 90, subdivision: 16, tracks: [{ name: "Alfaia", steps: ["R", ".", "L", "."] }] }, new URL(page.url()).origin);
  await page.evaluate((url) => { window.location.hash = new URL(url).hash; }, url);
  await expect(page.getByRole("heading", { name: "Incoming rhythm", exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("baque-facil-composer-draft:new")!).title)).toBe("Keep the latest edit");
  await page.clock.resume();
  await page.goto("/compose/");
  await expect(page.getByRole("heading", { name: "Keep the latest edit", exact: true })).toBeVisible();
});

test("clipboard failure leaves a selectable link, and editing clears stale links", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("Denied")) } }));
  await page.goto("/compose/marcacao/");
  const url = await share(page);
  await expect(page.getByText("Copy unavailable. Select and copy the link below.", { exact: true })).toBeVisible();
  await linkField(page).focus();
  expect(await linkField(page).evaluate((element: HTMLInputElement) => element.selectionEnd! - element.selectionStart!)).toBe(url.length);
  await chooseNote(page, "Alfaia step 1: R", "Border");
  await expect(linkField(page)).toHaveCount(0);
  expect(await share(page)).not.toBe(url);
});

test("typing a rhythm name never triggers playback, recording or note shortcuts", async ({ page }) => {
  await page.goto("/compose/");
  await page.getByRole("button", { name: "Rename rhythm", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Rhythm name", exact: true });
  await input.fill("");
  await input.pressSequentially("f j b r m l c + -");
  await input.press("Enter");
  await expect(page.getByRole("heading", { name: "f j b r m l c + -", exact: true })).toBeVisible();
  await expect(page.locator(".count-in")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  await expect(notes(page)).toHaveText(Array(16).fill("·"));
  await expect(page.getByRole("slider", { name: "Tempo", exact: true })).toHaveValue("90");
});

test("shared subdivisions control the grid and survive re-sharing", async ({ page }) => {
  for (const subdivision of [8, 16, 32] as const) {
    const rhythm: Rhythm = { title: `Subdivision ${subdivision}`, slug: "test", tempo: 90, subdivision, tracks: [{ name: "Gongue", steps: ["X", ".", "x", ".", "X", ".", "x", "."] }] };
    await page.goto("/compose/");
    await page.goto(createRhythmShareUrl(rhythm, new URL(page.url()).origin));
    await expect(page.getByRole("heading", { name: rhythm.title, exact: true })).toBeVisible();
    await expect(page.locator(".composer-beat-label")).toHaveCount(32 / subdivision);
    expect(readRhythmShareUrl(await share(page))?.subdivision).toBe(subdivision);
  }
});

test("sharing guards protect invalid transcription and count-in/recording without restricting long compositions", async ({ page }) => {
  await page.goto("/compose/");
  const button = page.getByRole("button", { name: "Share rhythm", exact: true });
  const transcription = await openTranscription(page);
  await transcription.fill("Alfaia:\nQ");
  await expect(button).toBeDisabled();
  await expect(page.getByText("Fix the transcription errors before sharing a rhythm.", { exact: true })).toBeVisible();
  await transcription.fill(`Alfaia:\n${Array(1500).fill("L").join(" ")}`);
  await button.click();
  await expect(page.getByRole("alert")).toContainText("too large for a share link");
  await expect(notes(page)).toHaveCount(1500);
  await page.getByRole("button", { name: "Add beat", exact: true }).click();
  await expect(notes(page)).toHaveCount(1504);
  await transcription.fill("Alfaia:\nL . R B");
  await share(page);
  await openPads(page);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(button).toBeDisabled();
  await expect(linkField(page)).toHaveCount(0);
  await page.clock.runFor(2200);
  await expect(page.getByRole("button", { name: "Stop recording", exact: true })).toBeVisible();
  await expect(button).toBeDisabled();
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  await page.clock.resume();
  await expect(button).toBeEnabled();
});

test("bad shared links are recoverable and leave an existing draft intact", async ({ page }) => {
  await page.goto("/compose/");
  await rename(page, "Keep my draft");
  await expect(page.getByText("Saved on this device", { exact: true })).toBeVisible();
  for (const encoded of ["", "not-json", "a".repeat(2001), Buffer.from('{"v":99}').toString("base64url"), Buffer.from('{"v":1,"tracks":null}').toString("base64url")]) {
    await page.goto(`/compose/#rhythm=${encoded}`);
    await expect(page.getByRole("alert")).toContainText("Unable to open shared rhythm");
    await expect(page.getByRole("button", { name: "Share rhythm", exact: true })).toHaveCount(0);
  }
  await page.getByRole("link", { name: "Open my composer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Keep my draft", exact: true })).toBeVisible();
});

test("Portuguese sharing labels and errors preserve authored names and fit mobile screens", async ({ page }) => {
  await page.goto("/compose/");
  await rename(page, "Meu ritmo 🥁");
  const url = await share(page);
  await page.goto(url);
  await page.locator(".language-bar").getByRole("button", { name: "Português (Brasil)", exact: true }).click();
  await page.getByRole("button", { name: "Compartilhar ritmo", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Link do ritmo", exact: true })).toHaveValue(url);
  await expect(page.getByRole("heading", { name: "Meu ritmo 🥁", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto("/compose/#rhythm=broken");
  await expect(page.getByRole("alert")).toContainText("Este link de ritmo é inválido ou está incompleto.");
  await expect(page.getByRole("link", { name: "Abrir meu compositor", exact: true })).toBeVisible();
});

test("codec enforces the actual URL budget and validates every musical field", () => {
  const rhythm: Rhythm = { title: "Test", slug: "test", tempo: 90, subdivision: 16, tracks: [{ name: "Alfaia", steps: ["L", ".", "R", "B"] }] };
  const origin = "https://example.com";
  const url = createRhythmShareUrl(rhythm, origin);
  const valid = JSON.parse(Buffer.from(new URL(url).hash.slice(8), "base64url").toString("utf8"));
  const encode = (value: unknown) => `${origin}/compose/#rhythm=${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
  for (const invalid of [
    null, [], {}, { ...valid, v: 2 }, { ...valid, name: "" }, { ...valid, name: "x\ny" }, { ...valid, name: "x".repeat(201) },
    ...[0, 29, 131, 90.5, "90"].map((tempo) => ({ ...valid, tempo })),
    { ...valid, subdivision: 4 }, { ...valid, tracks: [] },
    ...[
      [{ name: "Unknown", steps: "...." }], [{ name: "Alfaia", steps: "Q" }],
      [{ name: "Alfaia", steps: ["L"] }], [{ name: "Alfaia", steps: "" }],
      [{ name: "Alfaia", steps: "L" }, { name: "Alfaia", steps: "R" }],
      [{ name: "Alfaia", steps: "L" }, { name: "Caixa", steps: "XX" }],
    ].map((tracks) => ({ ...valid, tracks })),
  ]) expect(() => readRhythmShareUrl(encode(invalid))).toThrow();
  for (const subdivision of [8, 16, 32] as const) {
    expect(readRhythmShareUrl(createRhythmShareUrl({ ...rhythm, subdivision }, origin))?.subdivision).toBe(subdivision);
  }
  expect(readRhythmShareUrl(`${origin}/compose/`)).toBeNull();
  // Find the exact boundary for this origin/name; check both sides and a longer origin.
  let lastUrl = url;
  let limit = 0;
  for (let size = 1200; size < 1500; size++) {
    const candidate = { ...rhythm, tracks: [{ name: "Alfaia", steps: Array(size).fill(".") }] };
    try { lastUrl = createRhythmShareUrl(candidate, origin); limit = size; }
    catch { break; }
  }
  expect(lastUrl.length).toBeLessThanOrEqual(MAX_SHARE_URL_LENGTH);
  expect(lastUrl.length).toBeGreaterThanOrEqual(MAX_SHARE_URL_LENGTH - 1);
  expect(readRhythmShareUrl(lastUrl)?.tracks[0].steps).toHaveLength(limit);
  expect(() => createRhythmShareUrl({ ...rhythm, tracks: [{ name: "Alfaia", steps: Array(limit + 1).fill(".") }] }, origin)).toThrow(/too large/);
  expect(() => createRhythmShareUrl({ ...rhythm, tracks: [{ name: "Alfaia", steps: Array(limit).fill(".") }] }, "https://longer-domain.example.com")).toThrow(/too large/);
});

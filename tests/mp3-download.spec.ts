import { openTranscription, openPads } from "./composer-helpers";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("baque-facil-language", "en-CA"));
});

async function openExport(page: Page, route: string) {
  await page.goto(route);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  if (!route.startsWith("/compose/")) await expect(page.locator(".player-secondary-actions .copy-transcription-button + .download-mp3-button")).toBeVisible();
  await expect(page.locator(".mp3-export")).toBeHidden();
  await page.getByRole("button", { name: route.startsWith("/compose/") ? "Export" : "Download MP3", exact: true }).click();
  if (route.startsWith("/compose/")) await openTranscription(page);
}

async function save(page: Page, label = "Save MP3") {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: label, exact: true }).click();
  const download = await pending;
  const path = await download.path();
  expect(await download.failure()).toBeNull();
  const bytes = await readFile(path!);
  expect(bytes.length).toBeGreaterThan(1000);
  return { filename: download.suggestedFilename(), bytes };
}

for (const scenario of [
  { route: "/rhythms/marcacao/", repetitions: "8", filename: "1-marcacao" },
  { route: "/rhythms/combo_entrada/", repetitions: "1", filename: "entrada" },
  { route: "/compose/", repetitions: "1", filename: "my-rhythm" },
  { route: "/compose/marcacao/", repetitions: "1", filename: "1-marcacao" },
]) {
  test(`downloads a playable MP3 from ${scenario.route}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openExport(page, scenario.route);
    await expect(page.getByLabel("Repetitions", { exact: true })).toHaveValue(scenario.repetitions);
    if (scenario.route.startsWith("/compose/")) {
      await page.getByRole("textbox", { name: "Transcription" }).fill("Alfaia:\n. R . . | . . . L");
    }
    await page.locator(".player-panel .tempo-control input").fill("120");
    await page.getByLabel("Repetitions", { exact: true }).selectOption("1");
    await page.getByRole("button", { name: "Prepare MP3", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save MP3", exact: true })).toBeVisible({ timeout: 20000 });
    const file = await save(page);
    expect(file.filename).toBe(`${scenario.filename}-120bpm-1x.mp3`);
    const decoded = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const buffer = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(bytes.buffer);
      return { duration: buffer.duration, peak: buffer.getChannelData(0).reduce((peak, value) => Math.max(peak, Math.abs(value)), 0) };
    }, file.bytes.toString("base64"));
    expect(decoded.duration).toBeGreaterThanOrEqual(1);
    expect(decoded.peak).toBeGreaterThan(0.01);
    expect(decoded.peak).toBeLessThan(1);
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("composer guards invalid, silent and recording states, and download button keyboard activation does not play", async ({ page }) => {
  await openExport(page, "/compose/");
  const prepare = page.getByRole("button", { name: "Prepare MP3", exact: true });
  await expect(prepare).toBeDisabled();
  await expect(page.getByText("Add a note or unmute a track to prepare an MP3.")).toBeVisible();
  const transcription = page.getByRole("textbox", { name: "Transcription" });
  await transcription.fill("Alfaia:\nR . . .");
  await expect(prepare).toBeEnabled();
  await transcription.fill("Alfaia:\nQ");
  await expect(prepare).toBeDisabled();
  await expect(page.getByText("Fix the transcription errors before preparing an MP3.")).toBeVisible();
  await transcription.fill("Alfaia:\nR . . .");
  await page.getByRole("button", { name: "Mute Alfaia", exact: true }).click();
  await expect(prepare).toBeDisabled();
  await page.getByRole("button", { name: "Unmute Alfaia", exact: true }).click();
  const toggle = page.getByRole("button", { name: "Export", exact: true });
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".mp3-export")).toBeHidden();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".mp3-export")).toBeVisible();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await openPads(page);
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(prepare).toBeDisabled();
  await expect(page.getByText("Stop recording before preparing an MP3.")).toBeVisible();
  await page.getByRole("button", { name: /Cancel count-in|Stop recording/ }).click();
});

test("export captures edits and tempo, supports repeated saves, cancellation and retry", async ({ page }) => {
  await openExport(page, "/compose/marcacao/");
  const prepare = page.getByRole("button", { name: "Prepare MP3", exact: true });
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/samples/**", async (route) => { await gate; await route.continue().catch(() => {}); });
  await prepare.click();
  await page.locator(".player-panel .tempo-control input").fill("100");
  await page.getByRole("textbox", { name: "Transcription" }).fill("Alfaia:\nL . . .");
  release();
  await page.unroute("**/samples/**");
  await expect(page.getByRole("button", { name: "Save MP3", exact: true })).toBeVisible();
  await expect(page.getByText(/This file uses the settings captured/)).toBeVisible();
  const first = await save(page);
  expect(first.filename).toBe("1-marcacao-90bpm-1x.mp3");
  expect((await save(page)).bytes.equals(first.bytes)).toBe(true);
  await prepare.click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("MP3 preparation cancelled.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save MP3", exact: true })).toHaveCount(0);
  await page.route("**/samples/**", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
  await prepare.click();
  await expect(page.locator(".mp3-export [role=alert]")).toContainText("Unable to load a drum sample");
  await page.unroute("**/samples/**");
  await prepare.click();
  await expect(page.getByRole("button", { name: "Save MP3", exact: true })).toBeVisible();
  expect((await save(page)).filename).toBe("1-marcacao-100bpm-1x.mp3");
});

test("radio saves the exact full mix while held and with pending or cancelled settings", async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => localStorage.setItem("baque-facil-radio-v1", JSON.stringify({
    slugs: ["marcacao", "imale"], tempo: 90, repetitions: 4, minutes: 2,
  })));
  await page.goto("/radio/");
  const download = page.getByRole("button", { name: "Download mix MP3", exact: true });
  await expect(download).toBeDisabled();
  await expect(download.locator("svg")).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(download).toBeEnabled({ timeout: 25000 });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const audio = page.locator("audio[data-radio-player]");
  const original = await audio.getAttribute("src");
  const digest = await audio.evaluate(async (element: HTMLAudioElement) => {
    const bytes = await (await fetch(element.src)).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  });
  const initial = await save(page, "Download mix MP3");
  expect(createHash("sha256").update(initial.bytes).digest("hex")).toBe(digest);
  await page.getByRole("button", { name: "Stay on this rhythm", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to mix", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await audio.getAttribute("src")).not.toBe(original);
  await page.getByRole("slider", { name: "Radio tempo" }).fill("100");
  const held = await save(page, "Download mix MP3");
  expect(held.bytes.equals(initial.bytes)).toBe(true);
  expect(held.filename).toMatch(/90bpm/);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/samples/**", async (route) => { await gate; await route.continue().catch(() => {}); });
  await page.getByRole("button", { name: "Apply settings", exact: true }).click();
  expect((await save(page, "Download mix MP3")).bytes.equals(initial.bytes)).toBe(true);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  release();
  await page.unroute("**/samples/**");
  expect((await save(page, "Download mix MP3")).bytes.equals(initial.bytes)).toBe(true);
  await page.route("**/samples/**", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
  await page.getByRole("button", { name: "Apply settings", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect((await save(page, "Download mix MP3")).bytes.equals(initial.bytes)).toBe(true);
  await page.unroute("**/samples/**");
  await page.getByRole("button", { name: "Apply settings", exact: true }).click();
  await expect(audio).not.toHaveAttribute("src", original!);
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0, { timeout: 25000 });
  const replacement = await save(page, "Download mix MP3");
  expect(replacement.filename).toMatch(/100bpm/);
  expect(replacement.bytes.equals(initial.bytes)).toBe(false);
});

test("export controls and availability messages are translated into Portuguese", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("baque-facil-language", "pt-BR"));
  await page.goto("/compose/");
  await page.getByRole("button", { name: "Exportar", exact: true }).click();
  await expect(page.getByLabel("Repetições", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preparar MP3", exact: true })).toBeDisabled();
  await expect(page.getByText("Adicione uma nota ou ative o som de um instrumento para preparar um MP3.")).toBeVisible();
  await page.goto("/radio/");
  await expect(page.getByRole("button", { name: "Baixar mix em MP3", exact: true })).toBeDisabled();
  await expect(page.getByText("Prepare um mix primeiro.")).toBeVisible();
});

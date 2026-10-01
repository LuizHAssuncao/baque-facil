import { expect, type Page } from "@playwright/test";

export async function openTranscription(page: Page) {
  const details = page.locator(".composer-transcription");
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await details.locator("summary").click();
  }
  return details.locator("textarea");
}

export async function chooseNote(page: Page, cell: string, note: string) {
  await page.getByRole("button", { name: cell, exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Change hit", exact: true })).toBeVisible();
  await page.getByRole("button", { name: note, exact: true }).click();
}

export async function openPads(page: Page) {
  const button = page.getByRole("button", { name: "Record with pads", exact: true });
  if (await button.isVisible()) await button.click();
}

export async function resetTake(page: Page) {
  const details = page.locator(".composer-more");
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) await details.locator("summary").click();
  await page.getByRole("button", { name: "Reset pattern", exact: true }).click();
  await details.locator("summary").click();
}

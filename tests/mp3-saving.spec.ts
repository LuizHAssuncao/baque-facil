import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("baque-facil-language", "en-CA"));
});

test("native sharing receives the prepared MP3 during the user gesture and failures permit saving", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", { configurable: true, value: async (data: ShareData) => {
      const file = data.files![0];
      sessionStorage.setItem("shared-mp3", JSON.stringify({ name: file.name, size: file.size, type: file.type, active: navigator.userActivation.isActive }));
    } });
  });
  await page.goto("/rhythms/marcacao/");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.getByRole("button", { name: "Download MP3", exact: true }).click();
  await page.getByRole("button", { name: "Prepare MP3", exact: true }).click();
  await page.getByRole("button", { name: "Share MP3", exact: true }).click();
  const shared = await page.evaluate(() => JSON.parse(sessionStorage.getItem("shared-mp3")!));
  expect(shared).toMatchObject({ name: "1-marcacao-90bpm-8x.mp3", type: "audio/mpeg", active: true });
  expect(shared.size).toBeGreaterThan(1000);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: async () => { throw new DOMException("Cancelled", "AbortError"); } });
  });
  await page.getByRole("button", { name: "Share MP3", exact: true }).click();
  await expect(page.locator(".mp3-export [role=alert]")).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: async () => { throw new Error("Unavailable"); } });
  });
  await page.getByRole("button", { name: "Share MP3", exact: true }).click();
  await expect(page.locator(".mp3-export [role=alert]")).toHaveText("Unable to share the MP3. Try Save MP3 instead.");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save MP3", exact: true }).click();
  expect(await (await pending).failure()).toBeNull();
});

test("saving owns a temporary URL and keeps it valid through the browser handoff", async ({ page }) => {
  await page.goto("/radio/");
  const result = await page.evaluate(async () => {
    const path = "/src/lib/audio/downloadMp3.ts";
    const { saveMp3 } = await import(/* @vite-ignore */ path);
    const originalClick = HTMLAnchorElement.prototype.click;
    const originalTimeout = window.setTimeout;
    const originalRevoke = URL.revokeObjectURL;
    const pending: (() => void)[] = [];
    const revoked: string[] = [];
    let href = "";
    let filename = "";
    const playbackUrl = URL.createObjectURL(new Blob(["playback"]));
    try {
      HTMLAnchorElement.prototype.click = function () { href = this.href; filename = this.download; };
      window.setTimeout = ((callback: () => void) => { pending.push(callback); return 1; }) as typeof window.setTimeout;
      URL.revokeObjectURL = (url) => { revoked.push(url); originalRevoke.call(URL, url); };
      saveMp3({ blob: new Blob(["test mp3"], { type: "audio/mpeg" }), filename: "test.mp3", duration: 1 });
      const beforeCleanup = await (await fetch(href)).text();
      const revokedBeforeCleanup = revoked.length;
      pending.forEach((callback) => callback());
      return { filename, beforeCleanup, revokedBeforeCleanup, revokedOwnUrl: revoked.length === 1 && revoked[0] === href, playbackStillValid: await (await fetch(playbackUrl)).text(), anchors: document.querySelectorAll('a[download="test.mp3"]').length };
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
      window.setTimeout = originalTimeout;
      URL.revokeObjectURL = originalRevoke;
      originalRevoke.call(URL, playbackUrl);
    }
  });
  expect(result).toEqual({ filename: "test.mp3", beforeCleanup: "test mp3", revokedBeforeCleanup: 0, revokedOwnUrl: true, playbackStillValid: "playback", anchors: 0 });
});

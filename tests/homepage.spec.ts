import { expect, test, type Locator, type Page } from "@playwright/test";

async function expectBelowNavigation(page: Page, target: Locator) {
  const navigation = await page.locator(".home-navigation").boundingBox();
  const destination = await target.boundingBox();
  expect(navigation).not.toBeNull();
  expect(destination).not.toBeNull();
  expect(destination!.y).toBeGreaterThanOrEqual(navigation!.y + navigation!.height);
  await expect(target).toBeInViewport({ ratio: 1 });
}

for (const locale of ["en-CA", "pt-BR"] as const) {
  test.describe(`homepage in ${locale}`, () => {
    const labels = locale === "pt-BR"
      ? { navigation: "Navegação principal", rhythms: "Ritmos", radio: "Rádio", compose: "Compor", jump: "Ir para combos", settings: "Configurações", return: "Todos os ritmos" }
      : { navigation: "Main navigation", rhythms: "Rhythms", radio: "Radio", compose: "Compose", jump: "Jump to combos", settings: "Settings", return: "All rhythms" };

    test.beforeEach(async ({ page }) => {
      await page.addInitScript((language) => localStorage.setItem("baque-facil-language", language), locale);
      await page.goto("/");
    });

    test("rhythms and every activity are visible on arrival and navigation stays reachable", async ({ page }, testInfo) => {
      const navigation = page.getByRole("navigation", { name: labels.navigation });
      await expect(navigation.getByRole("link", { name: labels.rhythms })).toHaveAttribute("aria-current", "page");
      for (const link of await navigation.getByRole("link").all()) {
        await expect(link).toBeInViewport({ ratio: 1 });
        const box = await link.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
      }
      const rhythms = page.getByRole("region", { name: labels.rhythms, exact: true }).locator(".rhythm-link");
      for (const rhythm of await rhythms.all()) await expect(rhythm).toBeVisible();
      for (let index = 0; index < 4; index += 1) {
        await expect(rhythms.nth(index)).toBeInViewport({ ratio: 1 });
      }
      const combos = page.getByRole("region", { name: "Combos", exact: true }).locator(".rhythm-link");
      expect(await combos.count()).toBeGreaterThan(0);
      for (const combo of await combos.all()) await expect(combo).toBeVisible();
      await expect(combos.locator("strong")).toHaveText([
        "Entrada",
        "Parada + Arrasto",
        "Flying four",
        "Martelo break",
        "Three Crossed Break",
      ]);
      await page.screenshot({ path: testInfo.outputPath(`home-${locale}.png`) });

      await page.locator("#settings summary").scrollIntoViewIfNeeded();
      for (const link of await navigation.getByRole("link").all()) {
        await expect(link).toBeInViewport({ ratio: 1 });
      }
      await page.screenshot({ path: testInfo.outputPath(`home-${locale}-scrolled.png`) });

      for (const [name, path, heading] of [
        [labels.radio, "/radio/", locale === "pt-BR" ? "Rádio Baque" : "Baque Radio"],
        ["Quiz", "/quiz/", "Quiz"],
        [labels.compose, "/compose/", locale === "pt-BR" ? "Compositor de alfaia" : "Alfaia Composer"],
      ]) {
        await navigation.getByRole("link", { name, exact: true }).click();
        expect(new URL(page.url()).pathname).toBe(path);
        await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
        await page.getByRole("link", { name: labels.return, exact: true }).click();
        await expect(rhythms.first()).toBeInViewport({ ratio: 1 });
      }
    });

    test("keyboard shortcuts reach their sections without hiding focus behind navigation", async ({ page }) => {
      const jump = page.getByRole("link", { name: labels.jump });
      await jump.focus();
      await page.keyboard.press("Enter");
      const combosHeading = page.getByRole("heading", { name: "Combos", exact: true });
      await expect(combosHeading).toBeFocused();
      await expectBelowNavigation(page, combosHeading);

      await page.keyboard.press("Tab");
      await expect(page.getByRole("region", { name: "Combos", exact: true }).getByRole("link").first()).toBeFocused();

      const rhythmsLink = page.getByRole("navigation", { name: labels.navigation }).getByRole("link", { name: labels.rhythms });
      await rhythmsLink.focus();
      await page.keyboard.press("Enter");
      const rhythmsHeading = page.getByRole("heading", { name: labels.rhythms, exact: true });
      await expect(rhythmsHeading).toBeFocused();
      await expectBelowNavigation(page, rhythmsHeading);

      const settingsLink = page.getByRole("link", { name: labels.settings, exact: true });
      await settingsLink.focus();
      await page.keyboard.press("Enter");
      const summary = page.locator("#settings summary");
      await expect(page.locator("#settings")).toHaveAttribute("open", "");
      await expect(summary).toBeFocused();
      await expectBelowNavigation(page, summary);
      await page.keyboard.press("Tab");
      await expect(page.locator(".language-settings button").first()).toBeFocused();

      // Reusing the shortcut must reopen the disclosure even when the hash is unchanged.
      await summary.click();
      await settingsLink.click();
      await expect(page.locator("#settings")).toHaveAttribute("open", "");
      await expect(summary).toBeFocused();
      await page.reload();
      await expect(page.locator("#settings")).toHaveAttribute("open", "");
      await expectBelowNavigation(page, summary);
    });

    test("narrow screens and enlarged text preserve links and readable content", async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 740 });
      await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      const navigation = page.getByRole("navigation", { name: labels.navigation });
      for (const link of await navigation.getByRole("link").all()) {
        await expect(link).toBeVisible();
        const clipped = await link.evaluate((element) => element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight);
        expect(clipped).toBe(false);
      }
      const overflow = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await page.getByRole("link", { name: labels.jump }).click();
      await expectBelowNavigation(page, page.getByRole("heading", { name: "Combos", exact: true }));
    });
  });
}

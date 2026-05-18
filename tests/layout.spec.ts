import { expect, test, type Page, type TestInfo } from "@playwright/test";

const routes = [
  { name: "home", path: "/", heading: "Baque Fácil" },
  { name: "compose", path: "/compose/", heading: "Alfaia Composer" },
  { name: "ios-audio-help", path: "/help/ios-audio/", heading: "Can't hear sound?" },
  { name: "rhythm-marcacao", path: "/rhythms/marcacao/", heading: "Marcação" },
  { name: "rhythm-combo1", path: "/rhythms/combo1/", heading: "Combo 1" },
];

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

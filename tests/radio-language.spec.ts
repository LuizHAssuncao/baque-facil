import { expect, test, type Page } from "@playwright/test";

async function switchLanguage(page: Page, name: string) {
  await page.locator(".language-bar").getByRole("button", { name }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("baque-facil-radio-v1", JSON.stringify({
      slugs: ["marcacao", "imale"], tempo: 90, repetitions: 4, minutes: 2,
    }));
  });
});

test("radio translates preparation and active playback without replacing the recording or settings", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/samples/**", async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });
  await page.goto("/radio/");
  await page.getByRole("dialog").getByRole("button", { name: "Português (Brasil)" }).click();
  await expect(page.getByRole("heading", { name: "Rádio Baque", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Duração da gravação" })).toHaveValue("2");
  await expect(page.getByRole("combobox", { name: "Repetições por ritmo" })).toHaveValue("4");
  await expect(page.locator(".radio-section-heading")).toContainText("2 ritmos selecionados");
  await expect(page.locator(".radio-footnote").first()).toContainText(/cerca de \d+,\d MB/);
  await page.getByRole("button", { name: "Reproduzir", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "Preparação da gravação" })).toBeVisible();
  await expect(page.locator(".radio-preparation").getByRole("status")).toContainText("Preparando sua sequência");
  await switchLanguage(page, "English (Canada)");
  await expect(page.getByRole("progressbar", { name: "Recording preparation" })).toBeVisible();
  await expect(page.locator(".radio-preparation").getByRole("status")).toContainText("Preparing your mix");
  release();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible({ timeout: 30_000 });
  const audio = page.locator("audio[data-radio-player]");
  const source = await audio.getAttribute("src");
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
  await switchLanguage(page, "Português (Brasil)");
  await expect(page.getByRole("button", { name: "Pausar", exact: true })).toBeVisible();
  await expect(audio).toHaveAttribute("src", source!);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);
  await expect(page.locator('.grid-scroll[aria-label="Grade do ritmo atual"]')).toBeVisible();
  await expect(page.getByRole("slider", { name: "Tempo da rádio" })).toHaveValue("90");
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.album)).toBe("Rádio Baque");
  await page.getByRole("button", { name: "Ficar neste ritmo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Voltar à sequência", exact: true })).toHaveAttribute("aria-pressed", "true");
  const heldSource = await audio.getAttribute("src");
  expect(heldSource).not.toBe(source);
  await switchLanguage(page, "English (Canada)");
  await expect(page.getByRole("button", { name: "Back to mix", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(audio).toHaveAttribute("src", heldSource!);
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.album)).toBe("Baque Radio");
  await page.getByRole("button", { name: "Back to mix", exact: true }).click();
  await expect(audio).toHaveAttribute("src", source!);
  await page.getByRole("slider", { name: "Radio tempo" }).fill("75");
  await switchLanguage(page, "Português (Brasil)");
  await expect(page.getByRole("slider", { name: "Tempo da rádio" })).toHaveValue("75");
  await expect(page.getByRole("button", { name: "Aplicar configurações" })).toBeVisible();
  await expect(page.locator(".radio-pending")).toHaveText("Suas novas configurações estão prontas. Aplique-as para preparar uma nova sequência.");
  await expect(audio).toHaveAttribute("src", source!);
  expect(errors).toEqual([]);
});

test("radio translates existing errors and selection states when the language changes", async ({ page }) => {
  await page.route("**/samples/**", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
  await page.goto("/radio/");
  await page.getByRole("dialog").getByRole("button", { name: "English (Canada)" }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Unable to load a drum sample. Please try again.");
  await switchLanguage(page, "Português (Brasil)");
  await expect(page.getByRole("alert")).toHaveText("Não foi possível carregar uma amostra de áudio. Tente novamente.");
  await page.getByRole("checkbox", { name: "2 - Imalê iniciante" }).uncheck();
  await expect(page.locator(".radio-section-heading")).toContainText("1 ritmo selecionado");
  await page.getByRole("checkbox", { name: "1 - Marcação iniciante" }).uncheck();
  await expect(page.locator('.radio-error[role="status"]')).toHaveText("Selecione pelo menos um ritmo para preparar uma sequência.");
  await expect(page.getByRole("button", { name: "Reproduzir", exact: true })).toBeDisabled();
  await switchLanguage(page, "English (Canada)");
  await expect(page.locator('.radio-error[role="status"]')).toHaveText("Select at least one rhythm to prepare a mix.");
  await expect(page.locator(".radio-section-heading")).toContainText("0 rhythms selected");
});

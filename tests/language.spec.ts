import { expect, test, type Page } from "@playwright/test";
import { sampleMap } from "../src/lib/sampleMap";
import { portuguese, translate } from "../src/lib/i18n/messages";

const languageKey = "baque-facil-language";
const english = "English (Canada)";
const portugueseLabel = "Português (Brasil)";

async function chooseLanguage(page: Page, name: string) {
  await page.getByRole("dialog").getByRole("button", { name }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
}

async function switchLanguage(page: Page, name: string) {
  await page.locator(".language-bar").getByRole("button", { name }).click();
}

test("home difficulty tags keep a single border when switching languages", async ({ page }) => {
  await page.goto("/");
  await chooseLanguage(page, english);

  const cards = page.locator(".rhythm-list .rhythm-link");
  const tags = cards.locator(":scope > span");
  expect(await cards.count()).toBeGreaterThan(0);
  await expect(tags).toHaveCount(await cards.count());

  for (const [locale, language] of [
    ["en-CA", english],
    ["pt-BR", portugueseLabel],
    ["en-CA", english],
  ]) {
    await switchLanguage(page, language);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);

    for (const tag of await tags.all()) {
      await expect(tag.locator("[data-language]:visible")).toHaveCount(1);
      await expect(tag.locator(`[data-language="${locale}"]`)).toBeVisible();

      // Count rendered borders so nested translation markup cannot add a second pill.
      const borderedLayers = await tag.evaluate((element) =>
        [element, ...element.querySelectorAll("*")].filter((layer) => {
          if (layer.getClientRects().length === 0) return false;
          const style = getComputedStyle(layer);
          return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
            .some((width) => parseFloat(width) > 0);
        }).length,
      );
      expect(borderedLayers, `${locale}: ${await tag.innerText()}`).toBe(1);

      const label = tag.locator(`[data-language="${locale}"]`);
      await expect(label).toHaveCSS("padding", "0px");
      await expect(label).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    }
  }
});

test("translated messages retain every interpolation parameter", () => {
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [key, value] of Object.entries(portuguese)) {
    expect(value.trim(), key).not.toBe("");
    expect(placeholders(value), key).toEqual(placeholders(key));
  }
  for (const locale of ["en-CA", "pt-BR"] as const) {
    expect(translate(locale, "Quiz")).toBe("Quiz");
    expect(translate(locale, "Tempo")).toBe("Tempo");
  }
});

for (const locale of ["pt-BR", "en-CA"] as const) {
  test(`first visit chooses ${locale}, persists through reload, navigation, and a new session`, async ({ page, context, browser }) => {
    const name = locale === "pt-BR" ? portugueseLabel : english;
    await page.goto("/quiz/");
    await expect(page.getByRole("dialog")).toHaveAccessibleName("Choose your language Escolha seu idioma");
    await chooseLanguage(page, name);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    expect(await page.evaluate((key) => localStorage.getItem(key), languageKey)).toBe(locale);
    await page.reload();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.getByRole("link", { name: locale === "pt-BR" ? "Todos os ritmos" : "All rhythms" }).click();
    await expect(page.getByRole("heading", { name: locale === "pt-BR" ? "Ritmos" : "Rhythms", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // Restoring browser storage in a fresh context simulates closing/reopening the browser.
    const reopened = await browser.newContext({ storageState: await context.storageState() });
    try {
      const nextPage = await reopened.newPage();
      await nextPage.goto(new URL("/compose/", page.url()).href);
      await expect(nextPage.locator("html")).toHaveAttribute("lang", locale);
      await expect(nextPage.getByRole("dialog")).not.toBeVisible();
      await expect(nextPage.getByRole("heading", { name: locale === "pt-BR" ? "Compositor de alfaia" : "Alfaia Composer" })).toBeVisible();
    } finally {
      await reopened.close();
    }
  });
}

test("settings and open tabs share the latest language without changing hand preference", async ({ page, context }) => {
  await page.goto("/");
  await chooseLanguage(page, portugueseLabel);
  await page.getByText("Configurações", { exact: true }).click();
  await page.getByRole("checkbox", { name: /Modo para canhotos/ }).check();
  const second = await context.newPage();
  await second.goto("/rhythms/marcacao/");
  await expect(second.locator(".player-panel")).toHaveAttribute("data-rendered-locale", "pt-BR");
  await page.locator(".language-settings").getByRole("button", { name: english }).click();
  await expect(second.locator("html")).toHaveAttribute("lang", "en-CA");
  await expect(second.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Left-handed mode/ })).toBeChecked();
  await expect(page.locator(".language-bar").getByRole("button", { name: english })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-CA");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("composer keeps edits and translates existing validation errors when language changes", async ({ page }) => {
  await page.goto("/compose/");
  await chooseLanguage(page, portugueseLabel);
  const transcription = page.getByRole("textbox", { name: "Transcrição", exact: true });
  await expect(transcription).toHaveValue(/Ritmo de alfaia sem título/);
  await transcription.fill("Alfaia:\nR Q . .");
  await expect(page.getByRole("alert")).toContainText('Símbolo desconhecido "Q"');
  await switchLanguage(page, english);
  await expect(transcription).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Transcription", exact: true })).toHaveValue("Alfaia:\nR Q . .");
  await expect(page.getByRole("alert")).toContainText('Unknown symbol "Q"');
  await page.getByRole("textbox", { name: "Transcription", exact: true }).fill("Alfaia:\nL R . B");
  await expect(page.getByRole("alert")).not.toBeVisible();
  await switchLanguage(page, portugueseLabel);
  await expect(page.getByRole("textbox", { name: "Transcrição", exact: true })).toHaveValue("Alfaia:\nL R . B");
  await expect(page.getByRole("button", { name: "Alfaia, posição 1: L", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Transcrição", exact: true }).fill("R L . .");
  await expect(page.getByRole("alert")).toContainText("A linha 1 tem notas antes do nome de um instrumento.");
});

test("switching language preserves active rhythm playback and tempo", async ({ page }) => {
  await page.goto("/rhythms/marcacao/");
  await chooseLanguage(page, english);
  await page.getByRole("slider", { name: "Tempo" }).fill("75");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await switchLanguage(page, portugueseLabel);
  await expect(page.getByRole("button", { name: "Parar", exact: true })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Tempo" })).toHaveValue("75");
  await expect.poll(() => page.locator(".step-cell.active").count()).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Parar", exact: true }).click();
});

test("quiz translates new feedback without resetting the correct-answer advance timer", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-01T12:00:00Z") });
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.route("**/quiz/rhythms.json", (route) => route.fulfill({ json: {
    samples: sampleMap,
    rhythms: [
      { title: "Marcação", slug: "marcacao", tempo: 90, subdivision: 16, tracks: [{ name: "Alfaia", steps: ["R", ".", "L", "."] }] },
      { title: "Imalê", slug: "imale", tempo: 90, subdivision: 16, tracks: [{ name: "Alfaia", steps: ["L", "R", "L", "."] }] },
      { title: "Trovão", slug: "trovao", tempo: 90, subdivision: 16, tracks: [{ name: "Alfaia", steps: ["R", "R", ".", "L"] }] },
    ],
  } }));
  await page.goto("/quiz/");
  await chooseLanguage(page, portugueseLabel);
  await expect(page.getByRole("button", { name: "Escolher opção A" })).toBeEnabled();
  await expect(page.locator("#quiz-prompt")).toHaveText("Imalê");
  await page.clock.pauseAt(new Date("2026-10-01T12:01:00Z"));
  await expect(page.locator(".quiz-listen-hint")).toHaveText("Cada opção toca duas vezes. Ouça novamente quantas vezes quiser.");
  await page.getByRole("button", { name: "Escolher opção A" }).click();
  await expect(page.getByRole("status", { name: "Resultado da resposta" })).toContainText("A opção A é Trovão. Ouça novamente e escolha outra.");
  await expect(page.locator(".quiz-option").first()).toContainText("Não corresponde");
  await switchLanguage(page, english);
  await expect(page.locator("#quiz-prompt")).toHaveText("Imalê");
  await expect(page.getByRole("status", { name: "Answer feedback" })).toContainText("Option A is Trovão. Listen again and choose another.");
  await page.getByRole("button", { name: "Choose option C" }).click();
  await expect(page.getByRole("status", { name: "Answer feedback" })).toContainText("Correct!");
  await page.clock.fastForward(1_000);
  await switchLanguage(page, portugueseLabel);
  await expect(page.getByRole("button", { name: "A opção C está correta" })).toBeDisabled();
  await expect(page.getByRole("status", { name: "Resultado da resposta" })).toContainText("A opção C corresponde a Imalê. Vamos para o próximo ritmo…");
  await page.clock.fastForward(999);
  await expect(page.locator("#quiz-prompt")).toHaveText("Imalê");
  await page.clock.fastForward(1);
  await page.clock.resume();
  await expect(page.locator("#quiz-prompt")).not.toHaveText("Imalê");
  await expect(page.getByRole("status", { name: "Resultado da resposta" })).toHaveText("Escolha com calma.");
});

test("first-visit dialog supports keyboard navigation without triggering composer shortcuts", async ({ page }) => {
  await page.goto("/compose/");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: portugueseLabel })).toBeFocused();
  await page.keyboard.press("r");
  await expect(page.locator(".count-in")).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: english })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: portugueseLabel })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".language-bar").getByRole("button", { name: portugueseLabel })).toBeFocused();
});

test("unsupported preferences prompt again and blocked storage still permits a language choice", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("baque-facil-language", "fr-CA"));
  await page.goto("/help/ios-audio/");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => { throw new DOMException("Storage blocked", "SecurityError"); } });
  });
  await chooseLanguage(page, portugueseLabel);
  await expect(page.getByRole("heading", { name: "Não está ouvindo o som?" })).toBeVisible();
  await switchLanguage(page, english);
  await expect(page.getByRole("heading", { name: "Can't hear sound?" })).toBeVisible();
});

test("storage blocked from the first load falls back to a working prompt", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Astro's development toolbar reads localStorage without a guard. It is absent
  // from production; omit it here so this tests the application's storage fallback.
  await page.route("**/dev-toolbar/entrypoint.js*", (route) => route.fulfill({
    contentType: "application/javascript",
    body: "export {};",
  }));
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => { throw new DOMException("Storage blocked", "SecurityError"); },
    });
  });
  await page.goto("/quiz/");
  await chooseLanguage(page, portugueseLabel);
  await expect(page.getByRole("button", { name: "Reproduzir áudio A" })).toBeVisible();
  await switchLanguage(page, english);
  await expect(page.getByRole("button", { name: "Play audio A" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("all main pages render Portuguese without errors or horizontal overflow", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/");
  await chooseLanguage(page, portugueseLabel);
  for (const [path, heading] of [
    ["/", "Baque Fácil"],
    ["/quiz/", "Quiz"],
    ["/radio/", "Rádio Baque"],
    ["/compose/", "Compositor de alfaia"],
    ["/compose/marcacao/", "Compositor de alfaia"],
    ["/rhythms/combo_parada_arrasto/", "Parada + Arrasto"],
    ["/help/ios-audio/", "Não está ouvindo o som?"],
    ["/diagnostics/background-audio/", "Teste de áudio em segundo plano"],
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.locator('[data-rendered-locale="en-CA"]')).toHaveCount(0);
    if (path === "/compose/") await expect(page).toHaveTitle("Compor | Baque Fácil");
    if (path === "/radio/") {
      await expect(page).toHaveTitle("Rádio Baque | Baque Fácil");
      await expect(page.getByRole("slider", { name: "Tempo da rádio" })).toBeVisible();
    }
    if (path === "/quiz/") {
      await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Conheça os ritmos de maracatu/);
    }
    if (path === "/rhythms/combo_parada_arrasto/") {
      await expect(page.locator('.content [data-language="pt-BR"]').last()).toBeVisible();
      await expect(page.locator('.content [data-language="en-CA"]').last()).toBeHidden();
    }
    const overflow = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`pt-${path.replaceAll("/", "_") || "home"}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

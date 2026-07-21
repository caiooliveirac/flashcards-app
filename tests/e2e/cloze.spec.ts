import { expect, test } from "@playwright/test";
import {
  clozeField,
  createDeckViaUi,
  LINE_END,
  LINE_START,
  MOD,
  uniqueDeckName,
} from "./helpers";

/**
 * ACEITE F2#2 (UI): modo "Ocultar trecho" (Ctrl+2), duas ocultações em grupos
 * NOVOS via teclado (seleção com Shift+setas + Ctrl+Shift+C) → preview com 2
 * cards → salvar → deck detail mostra a nota com 2 cards.
 */

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "aceite F2#2 é fluxo desktop de teclado");
});

test("nota cloze com 2 grupos gera 2 cards (teclado)", async ({ page }) => {
  const deckId = await createDeckViaUi(page, uniqueDeckName("F2#2 cloze"));
  await page.goto(`/decks/${deckId}/new`);
  await expect(page.locator('[aria-label="Frente do card"]')).toBeFocused({ timeout: 15_000 });

  // Ctrl+2 → modo "Ocultar trecho"; o editor de texto recebe o foco.
  await page.keyboard.press(`${MOD}+2`);
  await expect(page.getByRole("tab", { name: "Ocultar trecho" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(clozeField(page)).toBeFocused();

  await page.keyboard.type("Lima e a capital do Peru");

  /**
   * Seleciona uma palavra por teclado e oculta com Ctrl+Shift+C.
   * O ProseMirror ingere a seleção do DOM assíncronamente; o input sintético
   * (CDP) é mais rápido que esse flush e o handler do atalho leria uma seleção
   * ainda colapsada. Por isso: pausa curta (≈ ritmo humano) + re-tentativa
   * refazendo a seleção — tudo 100% teclado.
   */
  async function hideWordByKeyboard(
    navKey: string,
    selKey: string,
    chars: number,
    groupKey: string,
    word: string,
  ): Promise<void> {
    const chip = page.locator(`span[data-cloze-group="${groupKey}"]`);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.keyboard.press(navKey);
      for (let i = 0; i < chars; i += 1) await page.keyboard.press(selKey);
      await page.waitForTimeout(400);
      await page.keyboard.press(`${MOD}+Shift+C`);
      try {
        await expect(chip).toContainText(word, { timeout: 2_000 });
        return;
      } catch {
        // flush do PM ainda não tinha acontecido — refaz a seleção e repete
      }
    }
    await expect(chip).toContainText(word);
  }

  // "Lima": início da linha + Shift+→ x4 → grupo novo g1.
  await hideWordByKeyboard(LINE_START, "Shift+ArrowRight", 4, "g1", "Lima");
  // "Peru": fim da linha + Shift+← x4 → Ctrl+Shift+C de novo → grupo novo g2.
  await hideWordByKeyboard(LINE_END, "Shift+ArrowLeft", 4, "g2", "Peru");

  // Preview (debounce ~300ms) mostra os 2 cards que serão criados.
  const previewSection = page.getByRole("region", {
    name: "Prévia dos cards que serão criados",
  });
  await expect(previewSection.getByRole("heading")).toHaveText("Prévia");
  await expect(previewSection).toContainText("Este texto criará 2 cards");
  await expect(previewSection.getByRole("listitem")).toHaveCount(2);

  // Salva pelo teclado; contador da sessão registra os 2 cards.
  await page.keyboard.press(`${MOD}+Enter`);
  await expect(page.getByText(/^2 cards criados em /)).toBeVisible();
  await expect(clozeField(page)).toHaveText("");

  // Deck detail: a nota aparece como Cloze com 2 cards.
  await page.goto(`/decks/${deckId}`);
  await expect(page.getByText("Cloze", { exact: true })).toBeVisible();
  await expect(page.getByText("2 cards", { exact: true })).toBeVisible();
  await expect(page.getByText("Lima e a capital do Peru")).toBeVisible();
});

import { expect, test } from "@playwright/test";
import { createDeckViaUi, MOD, uniqueDeckName } from "./helpers";

/**
 * Regressão do "apareceu infinitas vezes".
 *
 * Dois defeitos batiam juntos na sessão: os irmãos de uma nota cloze não saíam
 * da fila já carregada no cliente (o servidor os enterra, mas a fila é um
 * snapshot da página), e o learn-ahead reapresentava cards antes do horário.
 */
test("cloze com 3 ocultações aparece UMA vez por sessão", async ({ page }) => {
  const deckId = await createDeckViaUi(page, uniqueDeckName("Cloze3"));

  await page.goto(`/decks/${deckId}/new`);
  await page.getByRole("tab", { name: /^(Ocultar trecho|Ocultar)$/ }).click();
  const editor = page.locator('[aria-label="Texto da nota com ocultações"]');
  await editor.click();

  // Três ocultações independentes → três cards irmãos da MESMA nota.
  for (const termo of ["sepse", "lactato", "vasopressor"]) {
    await page.keyboard.type(termo);
    for (let i = 0; i < termo.length; i++) await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press(`${MOD}+Shift+C`);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type(" ");
  }
  await page.keyboard.press(`${MOD}+Enter`);
  await expect(page.getByText(/nota criada/i).first()).toBeVisible();

  await page.goto(`/decks/${deckId}/review`);
  await expect(page.getByRole("button", { name: /Mostrar resposta/ })).toBeVisible();

  // A primeira avaliação enterra os irmãos: a sessão tem de acabar aí.
  await page.getByRole("button", { name: /Mostrar resposta/ }).click();
  await page.getByRole("button", { name: /^Bom/ }).click();

  await expect(page.getByText("Sessão concluída")).toBeVisible({ timeout: 10_000 });
  // Uma revisão feita — não três da mesma nota.
  await expect(page.getByText(/^1 revisão/)).toBeVisible();
});

test('"Difícil" não reapresenta o card no mesmo segundo', async ({ page }) => {
  const deckId = await createDeckViaUi(page, uniqueDeckName("Dificil"));
  await page.goto(`/decks/${deckId}/new`);
  await page.locator('[aria-label="Frente do card"]').click();
  await page.keyboard.type("Defina sepse segundo o Sepsis-3.");
  await page.locator('[aria-label="Verso do card"]').click();
  await page.keyboard.type("Disfunção orgânica por resposta desregulada à infecção.");
  await page.keyboard.press(`${MOD}+Enter`);
  await expect(page.getByText(/card criado/i).first()).toBeVisible();

  await page.goto(`/decks/${deckId}/review`);
  await page.getByRole("button", { name: /Mostrar resposta/ }).click();
  await page.getByRole("button", { name: /^Difícil/ }).click();

  // "Difícil" repete o passo de learning (~6min) — comportamento correto do
  // FSRS. O que não pode é o card voltar agora, dando sensação de travamento.
  await expect(page.getByText("Sessão concluída")).toBeVisible({ timeout: 10_000 });
});

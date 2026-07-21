import { expect, test } from "@playwright/test";
import {
  backField,
  createDeckViaUi,
  frontField,
  MOD,
  uniqueDeckName,
} from "./helpers";

/**
 * ACEITE F2#1: 5 cards básicos seguidos em < 60s SEM tocar no mouse.
 * Fluxo por card: digitar frente → Tab → digitar verso → Ctrl+Enter →
 * formulário limpa e o foco volta à frente.
 */

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "aceite F2#1 é fluxo desktop de teclado");
});

test("cria 5 cards básicos seguidos só com teclado em < 60s", async ({ page }, testInfo) => {
  const deckId = await createDeckViaUi(page, uniqueDeckName("F2#1 teclado"));
  await page.goto(`/decks/${deckId}/new`);

  // Foco inicial automático na frente — pré-condição do fluxo contínuo.
  await expect(frontField(page)).toBeFocused({ timeout: 15_000 });

  const start = Date.now();
  for (let i = 1; i <= 5; i += 1) {
    await page.keyboard.type(`Pergunta numero ${i}`);
    await page.keyboard.press("Tab");
    await expect(backField(page)).toBeFocused();
    await page.keyboard.type(`Resposta numero ${i}`);
    await page.keyboard.press(`${MOD}+Enter`);

    // Save confirmado: contador da sessão (aria-live) incrementa…
    await expect(
      page.getByText(new RegExp(`^${i} cards? criados? em `)),
    ).toBeVisible();
    // …o formulário limpa e o foco volta à frente.
    await expect(frontField(page)).toBeFocused();
    await expect(frontField(page)).toHaveText("");
    await expect(backField(page)).toHaveText("");
  }
  const elapsedMs = Date.now() - start;

  testInfo.annotations.push({
    type: "f2#1-tempo",
    description: `5 saves em ${elapsedMs}ms (limite 60000ms)`,
  });
  console.log(`[F2#1] tempo total dos 5 saves: ${elapsedMs}ms`);
  expect(elapsedMs).toBeLessThan(60_000);

  // Confirmação persistida: os 5 cards na lista do deck.
  await page.goto(`/decks/${deckId}`);
  await expect(page.getByRole("listitem").filter({ hasText: "Básico" })).toHaveCount(5);
  await expect(page.getByText("Pergunta numero 5")).toBeVisible();
});

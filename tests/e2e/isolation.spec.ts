import { expect, test } from "@playwright/test";
import { createDeckViaUi, loginViaForm, uniqueDeckName } from "./helpers";

/**
 * Vazamento básico de UI: o usuário e2e-b NÃO vê o deck do e2e (home vazia —
 * e2e-b nunca cria decks) e recebe 404 ao acessar /decks/[id] do outro.
 * (A suite bloqueadora de RLS vive em tests/integration/rls-*.)
 */

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "isolamento de UI coberto no desktop");
});

test("e2e-b não vê nem acessa o deck do e2e", async ({ page, browser }) => {
  // Usuário A (e2e, storageState do projeto) cria um deck via UI.
  const deckName = uniqueDeckName("Privado do e2e");
  const deckId = await createDeckViaUi(page, deckName);

  // Contexto LIMPO → login como e2e-b no form. storageState explícito vazio:
  // browser.newContext() HERDA as opções do projeto (incluindo a sessão do e2e).
  const contextB = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const pageB = await contextB.newPage();
  try {
    await loginViaForm(pageB, "e2e-b", "1234");

    // Home do e2e-b: vazia (estado "nenhum baralho"), sem o deck do e2e.
    await expect(pageB.getByRole("heading", { name: "Nenhum baralho ainda" })).toBeVisible();
    await expect(pageB.getByText(deckName)).toHaveCount(0);

    // Acesso direto ao deck do outro: 404 uniforme (não vaza existência).
    const response = await pageB.goto(`/decks/${deckId}`);
    expect(response?.status()).toBe(404);
    await expect(pageB.getByText(deckName)).toHaveCount(0);

    // Rota de criação dentro do deck alheio também é 404.
    const responseNew = await pageB.goto(`/decks/${deckId}/new`);
    expect(responseNew?.status()).toBe(404);
  } finally {
    await contextB.close();
  }

  // O deck continua visível para o dono.
  await page.goto("/");
  await expect(page.getByText(deckName)).toBeVisible();
});

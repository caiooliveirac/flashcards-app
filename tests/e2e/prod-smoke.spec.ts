import { expect, test } from "@playwright/test";

/**
 * Fluxo MVP completo em produção: login → criar baralho → criar card básico →
 * criar cloze → home com contagens → revisar (revelar + avaliar) → resumo →
 * home atualizada. Usa a credencial provisória do dono (caio/1234).
 * O baralho "Demo cliente <ts>" fica em produção de propósito (material de demo).
 */

const DECK_NAME = `Demo cliente ${Date.now()}`;

test("fluxo MVP ponta a ponta em produção", async ({ page }) => {
  // 1. Login
  await page.goto("/login");
  await page.getByLabel(/usuário/i).fill("caio");
  await page.getByLabel(/senha/i).fill("1234");
  await page.getByRole("button", { name: /entrar/i }).click();
  await expect(page.getByRole("heading", { name: "Seus baralhos" })).toBeVisible();

  // 2. Criar baralho
  await page.getByRole("link", { name: "Novo baralho" }).click();
  await page.getByLabel(/nome/i).fill(DECK_NAME);
  await page.getByRole("button", { name: /criar/i }).click();
  await expect(page.getByRole("heading", { name: "Seus baralhos" })).toBeVisible();
  const deckCard = page.locator("li", { hasText: DECK_NAME });
  await expect(deckCard).toBeVisible();

  // 3. Adicionar card básico
  await deckCard.getByRole("link", { name: /abrir baralho/i }).click();
  await page.getByRole("link", { name: "Adicionar cards" }).first().click();
  const front = page.locator('[aria-label="Frente do card"] .tiptap, [data-testid="front-editor"] .tiptap').first();
  const anyEditor = page.locator(".tiptap").first();
  const frontEditor = (await front.count()) > 0 ? front : anyEditor;
  await frontEditor.click();
  await page.keyboard.type("Capital do Peru?");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Lima");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByText("Card criado", { exact: true })).toBeVisible();

  // 4. Card cloze: modo "Ocultar trecho", ocultar uma palavra, salvar
  await page.getByRole("tab", { name: /ocultar trecho/i }).click();
  const clozeEditor = page.locator(".tiptap").last();
  await clozeEditor.click();
  await page.keyboard.type("Lima fica no Peru");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+Control+ArrowRight");
  await page.keyboard.press("Control+Shift+KeyC");
  await expect(page.getByText(/prévia — 1 card/i)).toBeVisible();
  await page.keyboard.press("Control+Enter");
  await expect(page.getByText(/2 cards criados/i)).toBeVisible();

  // 5. Home mostra contagens e o botão Revisar
  await page.goto("/");
  const deckAfter = page.locator("li", { hasText: DECK_NAME });
  await expect(deckAfter.getByText(/2 novos/)).toBeVisible();
  await expect(deckAfter.getByText(/0 a revisar/)).toBeVisible();

  // 6–10. Sessão de revisão: revelar e avaliar os 2 cards
  await deckAfter.getByRole("link", { name: "Revisar" }).click();
  await expect(page.getByText(/card 1 de 2/i)).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("group", { name: /avaliar resposta/i })).toBeVisible();
  await page.getByRole("button", { name: /^Bom/ }).click();
  await expect(page.getByText(/card 2 de 2/i)).toBeVisible();
  await page.keyboard.press("Space");
  await page.keyboard.press("Digit3");

  // 11. Resumo da sessão
  await expect(page.getByRole("heading", { name: /revisão concluída/i })).toBeVisible();
  await expect(page.getByText(/você revisou 2 cards/i)).toBeVisible();

  // 12. Home atualizada: nada novo pendente (cards em learning, due ~minutos)
  await page.getByRole("link", { name: "Voltar aos baralhos" }).click();
  const deckDone = page.locator("li", { hasText: DECK_NAME });
  await expect(deckDone.getByText(/0 novos/)).toBeVisible();
});

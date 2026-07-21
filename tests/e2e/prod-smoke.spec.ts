import { expect, test } from "@playwright/test";
import { expectAuthenticatedHome } from "./helpers";

/**
 * Fluxo MVP completo em produção: login → criar baralho → criar card básico →
 * criar cloze → home com contagens → revisar (revelar + avaliar) → resumo →
 * home atualizada. Usa a credencial provisória do dono (caio/1234).
 * O baralho "Demo cliente <ts>" fica em produção de propósito (material de demo).
 */

const DECK_NAME = `Demo cliente ${Date.now()}`;

// Sessão limpa: o storageState autenticado do projeto faria /login redirecionar
// para a home antes de o form aparecer.
test.use({ storageState: { cookies: [], origins: [] } });

test("fluxo MVP ponta a ponta em produção", async ({ page }) => {
  test.skip(
    !process.env.PROD_SMOKE,
    "Smoke de produção (cria deck de demo e usa caio/1234) — rode com PROD_SMOKE=1 apontando o baseURL para produção",
  );
  // 1. Login
  await page.goto("/login");
  await page.getByLabel(/usuário/i).fill("caio");
  await page.getByLabel(/senha/i).fill("1234");
  await page.getByRole("button", { name: /entrar/i }).click();
  await expectAuthenticatedHome(page);

  // 2. Criar baralho
  await page.getByRole("link", { name: "Novo baralho" }).click();
  await page.getByLabel(/nome/i).fill(DECK_NAME);
  await page.getByRole("button", { name: /criar/i }).click();
  await expectAuthenticatedHome(page);
  const deckCard = page.locator("article", { hasText: DECK_NAME });
  await expect(deckCard).toBeVisible();

  // 3. Adicionar card básico (deck vazio → CTA "Criar primeiro card")
  await deckCard.getByRole("link", { name: DECK_NAME, exact: true }).click();
  await page.getByRole("link", { name: "Criar primeiro card" }).click();
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
  await expect(page.getByText(/criará 1 card/)).toBeVisible();
  await page.keyboard.press("Control+Enter");
  await expect(page.getByText(/2 cards criados/i)).toBeVisible();

  // 5. Home mostra contagens ("□ Crescendo · 2 novos" + meta "2 cards · 2 novos")
  await page.goto("/");
  const deckAfter = page.locator("article", { hasText: DECK_NAME });
  await expect(deckAfter.getByText(/2 novos/).first()).toBeVisible();
  await expect(deckAfter.getByText("a revisar")).toBeVisible();

  // 6–10. Sessão de revisão via deck detail ("Estudar novos — 2"): revelar e avaliar
  await deckAfter.getByRole("link", { name: DECK_NAME, exact: true }).click();
  await page.getByRole("link", { name: /Estudar novos — 2/ }).click();
  await expect(page.getByText("1 de 2", { exact: true })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("group", { name: /avaliar resposta/i })).toBeVisible();
  await page.getByRole("button", { name: /^Bom/ }).click();
  await expect(page.getByText("2 de 2", { exact: true })).toBeVisible();
  await page.keyboard.press("Space");
  await page.keyboard.press("Digit3");

  // 11. Resumo da sessão ("Sessão concluída" + "2 cards em ~X minutos")
  await expect(page.getByText("Sessão concluída")).toBeVisible();
  await expect(page.getByRole("heading", { name: /2 cards em/ })).toBeVisible();

  // 12. Home atualizada: nada novo pendente (cards em learning, due ~minutos)
  await page.getByRole("link", { name: "Voltar aos baralhos" }).click();
  const deckDone = page.locator("article", { hasText: DECK_NAME });
  await expect(deckDone).toBeVisible();
  await expect(deckDone.getByText(/novos/)).toHaveCount(0);
});

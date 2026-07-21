import { expect, type Page } from "@playwright/test";
import { BRAND } from "../../src/lib/brand";

/**
 * Home autenticada: a marca no header global é um link para "/" (presente em
 * todos os viewports; o h1 da home é a manchete dinâmica, sem copy estável).
 */
export async function expectAuthenticatedHome(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(
    page.getByRole("banner").getByRole("link", { name: `${BRAND}.` }),
  ).toBeVisible({ timeout: 15_000 });
}

/**
 * Helpers compartilhados dos E2E da Fase 2.
 *
 * Atalhos: o app aceita e.metaKey OU e.ctrlKey em todos os atalhos próprios
 * (Ctrl/Cmd+Enter, Ctrl/Cmd+1..3, Ctrl/Cmd+Shift+C), então usamos SEMPRE
 * 'Control' — vale em linux/CI e também em macOS local.
 */
export const MOD = "Control";

/**
 * Navegação de linha é a única parte dependente de plataforma: em macOS o
 * Chromium mapeia Home/End para scroll (não move o caret em contenteditable);
 * Cmd+Setas é o equivalente. Em linux/CI, Home/End funcionam.
 */
export const IS_MAC = process.platform === "darwin";
export const LINE_START = IS_MAC ? "Meta+ArrowLeft" : "Home";
export const LINE_END = IS_MAC ? "Meta+ArrowRight" : "End";

/** PNG 1x1 válido (magic bytes reais — passa na validação do worker). */
export const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Login via formulário de /login (usado no setup e no isolation com user B). */
export async function loginViaForm(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Usuário").fill(username);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  // Sucesso: redirect para a home autenticada.
  await expectAuthenticatedHome(page);
}

/**
 * Cria um deck pela UI (/decks/new) e devolve o deckId.
 * createDeckAction redireciona para "/" — o id é extraído do link do nome do
 * deck na célula (redesign: o nome é o link para /decks/[id]).
 */
export async function createDeckViaUi(page: Page, name: string): Promise<string> {
  await page.goto("/decks/new");
  await page.getByLabel("Nome").fill(name);
  await page.getByRole("button", { name: "Criar baralho" }).click();
  await expectAuthenticatedHome(page);
  const openLink = page.getByRole("link", { name, exact: true });
  await expect(openLink).toBeVisible();
  const href = await openLink.getAttribute("href");
  const match = href?.match(/^\/decks\/([0-9a-f-]{36})$/i);
  if (!match?.[1]) {
    throw new Error(`href inesperado no link do deck: ${href ?? "null"}`);
  }
  return match[1];
}

/** Nome único por run — cada teste cria seus próprios decks. */
export function uniqueDeckName(prefix: string): string {
  return `${prefix} ${Date.now()}`;
}

/** Locators dos editores (o contenteditable do ProseMirror tem aria-label). */
export function frontField(page: Page) {
  return page.locator('[aria-label="Frente do card"]');
}
export function backField(page: Page) {
  return page.locator('[aria-label="Verso do card"]');
}
export function clozeField(page: Page) {
  return page.locator('[aria-label="Texto da nota com ocultações"]');
}

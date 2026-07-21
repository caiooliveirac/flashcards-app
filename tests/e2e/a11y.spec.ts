import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createDeckViaUi, uniqueDeckName } from "./helpers";

/**
 * Gate transversal de acessibilidade: axe sem violações 'critical' nas telas
 * da Fase 2 (/, /decks/new, deck detail, editor em modo básico e cloze).
 * Violações 'serious' NÃO falham o teste — são registradas como annotation e
 * no stdout para o relatório.
 */

interface ScanResult {
  screen: string;
  critical: string[];
  serious: string[];
}

async function scan(page: Page, screen: string): Promise<ScanResult> {
  const results = await new AxeBuilder({ page }).analyze();
  const fmt = (impact: string): string[] =>
    results.violations
      .filter((v) => v.impact === impact)
      .map((v) => `[${screen}] ${v.id}: ${v.help} (${v.nodes.length} nó(s))`);
  return { screen, critical: fmt("critical"), serious: fmt("serious") };
}

test("axe sem violações críticas nas telas da Fase 2", async ({ page }, testInfo) => {
  const deckName = uniqueDeckName("A11y");
  const deckId = await createDeckViaUi(page, deckName);
  const scans: ScanResult[] = [];

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Seus baralhos" })).toBeVisible();
  scans.push(await scan(page, "/"));

  await page.goto("/decks/new");
  await expect(page.getByRole("heading", { name: "Novo baralho" })).toBeVisible();
  scans.push(await scan(page, "/decks/new"));

  await page.goto(`/decks/${deckId}`);
  await expect(page.getByRole("heading", { name: deckName })).toBeVisible();
  scans.push(await scan(page, "deck detail"));

  await page.goto(`/decks/${deckId}/new`);
  await expect(page.getByRole("tab", { name: "Básico" })).toBeVisible();
  scans.push(await scan(page, "editor (básico)"));

  await page.getByRole("tab", { name: "Ocultar trecho" }).click();
  await expect(page.getByRole("tab", { name: "Ocultar trecho" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.locator('[aria-label="Texto da nota com ocultações"]'),
  ).toBeVisible();
  scans.push(await scan(page, "editor (cloze)"));

  const serious = scans.flatMap((s) => s.serious);
  if (serious.length > 0) {
    // 'serious' reportado sem falhar (gate só bloqueia 'critical').
    console.log(`[a11y] violações 'serious' (${serious.length}):\n${serious.join("\n")}`);
    testInfo.annotations.push({
      type: "a11y-serious",
      description: serious.join(" | "),
    });
  } else {
    console.log("[a11y] nenhuma violação 'serious' encontrada");
  }

  const critical = scans.flatMap((s) => s.critical);
  expect(critical, "violações 'critical' de acessibilidade").toEqual([]);
});

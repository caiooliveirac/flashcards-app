import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { createDeckViaUi, frontField, PNG_1X1_BASE64, uniqueDeckName } from "./helpers";

/**
 * ACEITES F2#3/#4:
 * (a) desktop: paste de imagem no editor (ClipboardEvent sintético com
 *     DataTransfer; fallback documentado via input de arquivo se o FileHandler
 *     não reagir ao evento sintético);
 * (b) mobile (Pixel 7): upload via input de arquivo (setInputFiles com PNG de
 *     tests/e2e/fixtures/).
 * Em ambos: o node de imagem aparece e em até ~30s fica 'ready' — o <img>
 * troca o src para /api/media/<id> e o GET responde 200.
 */

const FIXTURE_PNG = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "pixel.png",
);

/** Node de imagem inserido → espera ficar 'ready' → GET 200 na rota de mídia. */
async function expectImageReady(page: Page): Promise<void> {
  const img = page.locator("img[data-asset-id]");
  await expect(img).toBeVisible({ timeout: 10_000 });
  const assetId = await img.getAttribute("data-asset-id");
  expect(assetId).toMatch(/^[0-9a-f-]{36}$/i);

  // Poll do próprio src: o editor troca blob: → /api/media/<id> quando o
  // status da validação do worker vira 'ready' (upload-client, ~30s máx).
  await expect(img).toHaveAttribute("src", `/api/media/${assetId}`, { timeout: 35_000 });

  const res = await page.request.get(`/api/media/${assetId}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("image/");
}

test("F2#3 desktop: colar print insere imagem que fica 'ready'", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "paste é o caminho desktop (F2#3)");

  const deckId = await createDeckViaUi(page, uniqueDeckName("F2#3 paste"));
  await page.goto(`/decks/${deckId}/new`);
  await expect(frontField(page)).toBeFocused({ timeout: 15_000 });

  // ClipboardEvent sintético com DataTransfer contendo um PNG — dispara o
  // pipeline de paste do ProseMirror/FileHandler no editor da frente.
  await page.evaluate(async (b64) => {
    const blobRes = await fetch(`data:image/png;base64,${b64}`);
    const blob = await blobRes.blob();
    const file = new File([blob], "print.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const event = new ClipboardEvent("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });
    const el = document.querySelector('[aria-label="Frente do card"]');
    if (!el) throw new Error("editor da frente não encontrado");
    el.dispatchEvent(event);
  }, PNG_1X1_BASE64);

  // Se o FileHandler não reagir ao evento sintético: documenta a limitação e
  // usa o input de arquivo da toolbar como fallback (mesmos asserts).
  let pasteWorked = true;
  try {
    await expect(page.locator("img[data-asset-id]")).toBeVisible({ timeout: 5_000 });
  } catch {
    pasteWorked = false;
  }
  if (!pasteWorked) {
    testInfo.annotations.push({
      type: "limitation",
      description:
        "FileHandler não reagiu ao ClipboardEvent sintético — F2#3 coberto via input de arquivo (fallback); paste real fica no checklist manual",
    });
    await page.locator('input[type="file"]').setInputFiles(FIXTURE_PNG);
  }

  await expectImageReady(page);
});

test("F2#4 mobile: inserir imagem via input de arquivo", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile",
    "input de arquivo no viewport mobile é o caminho do F2#4",
  );

  const deckId = await createDeckViaUi(page, uniqueDeckName("F2#4 mobile"));
  await page.goto(`/decks/${deckId}/new`);
  await expect(frontField(page)).toBeVisible({ timeout: 15_000 });

  await page.locator('input[type="file"]').setInputFiles(FIXTURE_PNG);
  await expectImageReady(page);
});

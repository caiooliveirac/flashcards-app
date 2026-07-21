import { test as setup } from "@playwright/test";
import { loginViaForm } from "./helpers";

/**
 * Projeto 'setup': login via UI form com e2e/1234 → storageState reutilizado
 * pelos projetos chromium e mobile (tests/e2e/.auth ignorado via .gitignore).
 */
setup("login do usuário e2e", async ({ page }) => {
  await loginViaForm(page, "e2e", "1234");
  await page.context().storageState({ path: "tests/e2e/.auth/user.json" });
});

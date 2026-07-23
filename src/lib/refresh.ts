/**
 * Refino visual 2026 — sistema de rollback granular.
 *
 * Cada efeito é INDEPENDENTE e removível de três formas, sem afetar os outros:
 *   1. Env: tire a palavra de NEXT_PUBLIC_REFRESH (lida só aqui, aplicada no
 *      `<html data-r="…">`). Reverter é editar uma variável, sem novo build.
 *   2. Classe: cada efeito só age em elementos com sua classe opt-in
 *      (`.r-display`, `.r-lift`, `.r-halo`). Grão é global.
 *   3. Arquivo: apague `src/app/refresh/<efeito>.css` e o @import em globals.css.
 *
 * Vocabulário de flags: "type" · "depth" · "grain" · "halo".
 * Default (env ausente) = conjunto curado ligado. String vazia = tudo desligado.
 */
export const REFRESH_FLAGS = (
  process.env.NEXT_PUBLIC_REFRESH ?? "type depth grain halo"
).trim();

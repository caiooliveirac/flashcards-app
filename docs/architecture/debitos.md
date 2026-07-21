# Débitos técnicos

Registro contínuo (convenção do plano — atualizar a cada fase).

## Fase 1 (2026-07-21)

1. **E2E de login real pendente** — bloqueado pelo OAuth client (ação externa). O fluxo completo criar-conta→shell será coberto por Playwright quando a credencial existir (aceite F1#1 parcialmente verificado: página, proxy e redirect testados no browser; sessão real não).
2. **Playwright ainda não configurado** — entra na Fase 2 junto com os primeiros fluxos E2E de criação (nenhum fluxo E2E da Fase 1 é executável sem OAuth).
3. **`notes.ai_generation_id` sem FK** — FK real entra na migration da Fase 5 (expand-and-contract), idem `review_logs.study_session_id` na Fase 3.
4. **Dark mode**: tokens prontos em `globals.css`, mas sem toggle/aplicação da classe `.dark` (UI de tema entra na Fase 2 com o design system real).
5. **Dev local usa Postgres 18** (Homebrew) vs 16 em produção/CI — CI é a referência; nenhuma feature específica de versão em uso.

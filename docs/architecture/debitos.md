# Débitos técnicos

Registro contínuo (convenção do plano — atualizar a cada fase).

## Fase 1 (2026-07-21)

1. **E2E de login real pendente** — bloqueado pelo OAuth client (ação externa). O fluxo completo criar-conta→shell será coberto por Playwright quando a credencial existir (aceite F1#1 parcialmente verificado: página, proxy e redirect testados no browser; sessão real não).
2. **Playwright ainda não configurado** — entra na Fase 2 junto com os primeiros fluxos E2E de criação (nenhum fluxo E2E da Fase 1 é executável sem OAuth).
3. **`notes.ai_generation_id` sem FK** — FK real entra na migration da Fase 5 (expand-and-contract), idem `review_logs.study_session_id` na Fase 3.
4. **Dark mode**: tokens prontos em `globals.css`, mas sem toggle/aplicação da classe `.dark` (UI de tema entra na Fase 2 com o design system real).
5. **Dev local usa Postgres 18** (Homebrew) vs 16 em produção/CI — CI é a referência; nenhuma feature específica de versão em uso.
6. **SHAs das actions do CI apontam builds Node 20** (herdados do `plantoes`; GitHub anota depreciação e força Node 24). Atualizar os pins para as releases atuais de checkout/setup-node/pnpm-action na próxima mexida no workflow.
7. **Login por senha sem rate-limit/lockout** — adicionar na Fase 7 (hardening) junto com os rate limits gerais; sem 2FA (aceito pelo dono).
8. **Credencial provisória `caio`/`1234` em produção** — trocar pelo próprio painel `/admin` assim que conveniente; senha mínima de 4 chars é provisória e sobe para 8+ quando houver usuários reais.
9. **Sessões JWT não são revogáveis server-side** — rebaixamento de admin tem efeito imediato (requireAdmin revalida no banco), mas logout forçado global exige trocar `AUTH_SECRET`. Aceito enquanto a base de usuários é o dono.
10. **Termos de uso (F6) devem declarar o acesso administrativo auditado** ao conteúdo (decisão D24) antes de abrir cadastro público.

# Pós-MVP — registrado, NÃO implementar agora

Itens deixados de fora do MVP demonstrável (2026-07-21), em ordem de valor:

1. ~~**Fase 3 completa da revisão**~~ **FEITO (2026-07-21, plano retomado por ordem
   do dono):** undo compensatório (`origin='undo'`), sibling burial, reentrada
   intra-sessão de learning + learn-ahead 20min, limites diários por timezone
   (`day_start_hour`), `study_sessions` + `daily_study_metrics` (job noturno do
   worker), intervalos previstos nos 4 botões, detecção de leeches, suspender/
   enterrar pela UI. Aceites F3#1–#7 testados (152 unit + 104 integração).
   Deferições conscientes registradas na seção Fase 3 de `debitos.md`.
2. **Temperatura real**: a da home é regra fixa por contagem (0 = em dia,
   1–9 = atenção, ≥10 = quente). A materializada em `deck_stats` com
   retrievability (Fase 4) substitui.
3. **Fases 4–7 do plano original** (dashboard, backlog, notificações, IA,
   comunidade, produção completa) — plano suspenso, ver
   `docs/architecture/fase-0-plano.md`.
4. **E2E do fluxo de revisão** (Playwright — a suite da Fase 2 cobre criação;
   revisão está coberta por integração) + E2E no CI.
5. **Débitos vivos** em `docs/architecture/debitos.md` (F1 #1–10, F2 #1–16) —
   nenhum bloqueia a demonstração.
6. **UX menores**: toast pós-edição com o plano de matching detalhado;
   `getNoteForEdit` promovido ao service de notas; contagem "a revisar" da
   home poderia atualizar ao voltar da sessão sem reload completo (hoje o RSC
   refaz a query — suficiente).

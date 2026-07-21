# Pós-MVP — registrado, NÃO implementar agora

Itens deixados de fora do MVP demonstrável (2026-07-21), em ordem de valor:

1. **Fase 3 completa da revisão**: undo compensatório (`origin='undo'`), sibling
   burial (revisar um cloze hoje revela os irmãos), reentrada intra-sessão de
   learning steps + learn-ahead 20min (hoje a fila é snapshot: card "Errei" com
   step de 1min só volta ao recarregar), limites diários por timezone com
   `day_start_hour`, `study_sessions` persistidas + `daily_study_metrics`,
   intervalos previstos nos 4 botões (`previewRatings`), detecção de leeches,
   suspender/enterrar pela UI.
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

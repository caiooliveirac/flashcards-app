---
name: montar-cards-residencia
description: Como criar e revisar flashcards de residência médica no baralho da Duda (projeto flashcards). Use ao adicionar, reescrever ou auditar cards clínicos em scripts/seed-duda.ts — padrão vinheta→decisão, disciplina de cloze, teste da "letra D", verificação de diretriz e ciclo de aplicação no banco.
---

# Montar cards de residência (baralho da Duda)

Objetivo: cards que treinam **decisão clínica** (próximo passo, prioridade, contraindicação, pegadinha), no nível de um preceptor de prova de residência — não recall de definição.

## Onde vivem e como aplicar
- Todos os cards estão em `scripts/seed-duda.ts` (array `DECKS`, DSL de helpers).
- ⚠️ O seed é **idempotente por NOME de deck**: rodar o seed NÃO atualiza um deck que já existe. Editar cards só chega ao banco apagando os decks da Duda e re-semeando (em dev não há histórico/revisões a preservar).

```bash
# 1) apagar os decks da Duda (role app + contexto RLS)
psql "$DATABASE_URL_APP" -c "BEGIN; SELECT set_config('app.current_user_id','<dudaId>',true); DELETE FROM decks WHERE owner_user_id='<dudaId>'; COMMIT;"
# 2) re-semear
pnpm exec tsx --env-file=.env.local scripts/seed-duda.ts
```
- `dudaId` em dev: `ebc924ed-167d-4f80-9c9f-578ccb3543e3` (confirmar com `SELECT id FROM users WHERE username='duda';`).
- Conexões no `.env.local`: `DATABASE_URL_APP` (RLS), `DATABASE_URL_SERVICE` (BYPASSRLS, só SELECT nas tabelas de domínio — use para inspecionar).

## DSL (helpers no topo do seed)
- `basic(front[], back[], tags[])` · `cloze(text[], tags[])`
- Inline: `t(texto, marks?)` (marks: `bold|italic|highlight|code`) · `math(latex)` · `cz(groupKey, texto, hint?)`
- Bloco: `p(...)` · `h(1|2|3, texto)` · `ul(...)`/`ol(...)` com `li(...)` · `callout("info|warning|success|danger", ...)` · `formula(latex)`
- **Verso decisório** (helpers dedicados): `resp(...)` (Resposta) · `gatilho(...)` (info) · `pegadinha(...)` (danger) · `excecao(...)` (warning).

## Anatomia do card ideal
**Frente** = vinheta curta com só os dados que mudam a decisão, terminando em pergunta objetiva:
- Qual a próxima conduta? / O que fazer primeiro? / O que EVITAR? / Qual exame prioritário? / O que muda a estratégia? / Por que a conduta proposta está errada?

**Verso** = `resp()` conduta objetiva → `gatilho()` o dado da vinheta que define → `pegadinha()` a alternativa sedutora e por que está errada → `excecao()` quando a resposta mudaria. Nem todo card usa os 4; a maioria usa 2–3.

```ts
basic(
  [p(t("Pneumonia, extremidades frias, confusão e "), t("PA 72 × 40", ["bold"]),
    t(". A equipe quer completar todo o volume antes do vasopressor. Próxima medida?"))],
  [
    resp(t("Iniciar "), t("noradrenalina já", ["bold"]), t(" (pode ser periférica) junto com a reposição.")),
    gatilho(t("Hipotensão profunda não tolera esperar “terminar o volume”.")),
    pegadinha(t("“Só posso iniciar vasopressor após todo o cristaloide” é falso.")),
  ],
  ["sepse", "vasopressor"],
),
```

## Regras (o que faz um card ser bom)
1. **Decisão, não definição.** Evitar "quais os critérios de X" / "liste as causas de Y". Se existir como suporte, deixar minoritário.
2. **Atomicidade.** 1 card = 1 decisão. Dividir cards que cobram dx + gravidade + exame + tratamento + dose juntos. Exceção: cadeia curta onde a sequência É o conhecimento (ex.: K baixo na CAD → repor antes da insulina).
3. **Teste da "letra D".** Para cada card pergunte: *qual alternativa errada um bom aluno marcaria?* A vinheta contém o discriminador? O verso explica por que a tentadora está errada? Se não, o card ainda é raso.
4. **Cloze com parcimônia.** Só para limiar/dose/alvo/fórmula/sequência curta. Irmãos independentes que não revelem a resposta uns dos outros; se cada omissão é uma decisão distinta, faça notas separadas. Nunca esconder metade de um parágrafo.
5. **Diretriz atual, não memória.** A data da sessão pode ser posterior ao cutoff do modelo — verifique números/condutas em diretriz primária (SSC, ADA, KDIGO, ESC, GINA/GOLD, ATS-IDSA, ACG) antes de fixar dose/limiar. Registrar a fonte em pontos controversos.
6. **Sem redundância.** Antes de criar, procure a habilidade já coberta; se o card existe e é fraco, melhore-o. "Diagnóstico", "conduta inicial" e "contraindicação" são recuperações diferentes — não são duplicatas.
7. **Símbolos Unicode** (≥, ≤, ×, →, ⁺, ₂) direto no texto; LaTeX só em `formula()`/`math()`. Sem HTML cru.

## Ciclo de trabalho
1. **Inventário:** ler todos os cards do tema (frente, verso, tipo, clozes, tags).
2. **Matriz de decisões:** listar 15–25 decisões clínicas distintas do tema; marcar bem coberta / fraca / ausente / duplicada.
3. **Implementar:** reescrever fracas, dividir densas, criar ausentes, fundir redundantes.
4. **Validar:** `npx tsc --noEmit` e `npx eslint scripts/seed-duda.ts`.
5. **Aplicar:** apagar decks da Duda + re-semear.
6. **Conferir no banco** (role service):
```sql
SELECT d.name,
  count(*) FILTER (WHERE note_type='basic')  AS basic,
  count(*) FILTER (WHERE note_type='cloze')  AS cloze,
  count(*) FILTER (WHERE search_text ILIKE '%Pegadinha:%') AS traps
FROM decks d JOIN notes n ON n.deck_id=d.id AND n.deleted_at IS NULL
WHERE d.owner_user_id='<dudaId>' GROUP BY d.position, d.name ORDER BY d.position;
```
   Checar: contagens por deck, variantes de cloze (`JOIN cards`), e **zero** artefatos (`search_text` sem `{{`, `undefined`, `[object`).

## Anti-exemplos (reescrever)
- "Qual é o vasopressor de escolha no choque séptico?" → vire vinheta de *timing/prioridade*.
- "A dose é {{c1::10 mg}}." → só se estiver claro por que memorizar aquele número muda a decisão.
- "A classificação tem {{c1::4}} estágios." → cobrar o estágio que muda conduta, não a contagem.

Relacionado: memórias `flashcards-seed-idempotente` e `flashcards-estilo-cards-duda`.

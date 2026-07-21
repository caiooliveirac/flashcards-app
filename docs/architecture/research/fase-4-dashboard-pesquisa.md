# Fase 4 — Pesquisa: o que faz um dashboard de estudo ser útil (FSRS-6)

Pesquisa multi-fonte com verificação adversarial (24/25 claims confirmados, 1 refutado).
Fontes primárias: manual do Anki (`docs.ankiweb.net/stats.html`), wiki/tutorial/FAQ do
Open Spaced Repetition, RCT npj Science of Learning 2025. Secundárias (contribuidores
FSRS): expertium.github.io, deepwiki. Data: 2026-07-21.

## Regra de dados transversal (CRÍTICA — o schema exige, as fontes do Anki não mencionam)

TODAS as métricas de retenção, contagem e forecast devem:
- **excluir** `review_logs.origin='undo'` **e os logs revertidos** (referenciados por `reverted_log_id`);
- **agrupar pelo dia de estudo** com corte às 4h no fuso do usuário (`src/lib/study-day.ts`).
Sem isso, true retention, streaks e daily load distorcem. (Já temos o helper e a regra no job de métricas.)

## 1) Qualidade da memória

- **True retention** (≠ "again rate" da sessão): conta **apenas a 1ª revisão de cada card por dia**;
  Again = falha, Hard/Good/Easy = acerto. Segmentar por **maturidade**: card **maduro = intervalo ≥ 21 dias**
  (a retenção real difere muito entre jovem e maduro). Fonte: manual Anki (primário).
  → No schema: `review_logs` (1º log de cada card por dia de estudo); `daily_study_metrics.retention_num/den`
  já serve SE respeitar a mesma regra. Classificar maduro por intervalo (de `card_progress`: due_at − última revisão, ou stability).
- **Retrievability atual** ("quão frágil está minha memória agora"): deriva de `stability` + tempo decorrido por
  **curva de POTÊNCIA** (não exponencial, FSRS-4.5+). Stability = tempo para R cair de 100%→90%; com desired retention 90%, intervalo = stability.
  → Ordenar cards por R crescente destaca os frágeis. Usar `card_progress.stability` e `now − last_reviewed`.
- **Distribuições de stability e difficulty** (histogramas) — fase 2, dados diretos de `card_progress`.
- **Armadilha:** a **retrievability MÉDIA da coleção é tipicamente MAIOR que a desired retention** (cards não vencidos
  estão acima do limiar; ex. 90% desired → ~94,7% média). Não confundir os dois números; média alta pode dar falsa segurança.

## 2) Previsão de carga

- **Future Due** (estilo Anki): reviews vencidas por dia futuro **assumindo nenhum card novo e nenhuma falha**.
  → `card_progress.due_at` agrupado por dia futuro (corte 4h), só cards não suspensos/enterrados. Armadilha: cards **já atrasados**
  não entram no forecast nativo — decidir como exibir backlog.
- **Carga média diária estacionária** = **soma de 1/intervalo por card** (número único). Fonte: manual Anki.
- **Impacto de N cards novos/dia**: forecast por intervalos atuais NÃO captura a carga que cards novos gerarão ao graduar —
  exige **simulação de regime estacionário**. O Anki Simulator usa parâmetros **SM-2 legados que NÃO se aplicam a FSRS-6** →
  precisa de modelagem nativa em ts-fsrs (fase 2, questão em aberto).

## 3) Hábito e motivação

- **Heatmap de calendário (estilo GitHub) + streak + tempo/dia** são valiosos. Evidência causal (RCT npj Science of Learning 2025,
  n=143): **recompensar por DIA praticado** elevou a média do exame de 81,7%→85,3% (p<0,05) vs. recompensar por volume de questões;
  dias praticados previram a nota mesmo controlando o total → favorece **meta DIÁRIA**.
  → `daily_study_metrics` (1 linha/dia) alimenta heatmap/streak; corte 4h define o dia.
- **Armadilhas** (fontes blog, menor confiança): streaks podem gerar ansiedade/gaming; faltou evidência primária comparando
  meta diária vs semanal e sobre o "paradoxo do streak" — tratar com cautela (ex.: streak tolerante a 1 falha).

## 4) Diagnóstico e ação

- **Desired retention**: curva de custo em **U** (workload não-linear, um mínimo por usuário). Faixa útil **80–95%, ~90% para a maioria**;
  **definir abaixo do recomendado é contraproducente** (mais trabalho para lembrar menos). Ótimo depende de parâmetros FSRS individuais,
  tempo por card (`duration_ms`), tamanho do deck e limite de novos. Computável por usuário (busca 0,70–0,95).
  ⚠️ 1 claim REFUTADO: o detalhe "método de Brent" NÃO se sustentou — a ideia da curva-U e do ótimo se mantém, o método exato não.
- **Reotimização FSRS**: no Anki **24.06.3+ roda com qualquer número de reviews** (adaptativo); 24.04 exigia 400, antigas 1000.
  Com poucos reviews só um subconjunto de parâmetros é otimizado. → Usar contagem de `review_logs` válidos para sugerir quando reotimizar.
  (Nosso otimizador ainda não existe — débito F3#5.)
- **Leeches / decks negligenciados**: SEM fonte primária sobreviveu (limiar de lapses, quando suspender vs reformular) — questão em aberto;
  usar `card_progress.lapses` (já temos LEECH_THRESHOLD=8) e "sem revisão há X dias" por deck.

## Priorização

**MVP (alto valor, fontes primárias, mapeia direto ao schema):**
1. **True retention** jovem vs maduro (1ª revisão/dia).
2. **Heatmap + streak + tempo/dia** com meta diária.
3. **Future Due** 7–30 dias (+ como mostrar backlog).
4. Card **"desired retention atual vs. recomendada"** (mesmo que a recomendada venha depois).

**Fase 2 (depende de modelagem própria ou dados secundários):**
- Distribuições de stability/difficulty; lista de cards **mais frágeis** por retrievability; **carga estacionária** (Σ 1/intervalo);
  **simulador de N novos/dia** FSRS-nativo; detecção de **leeches** e **decks negligenciados**; gatilho de reotimização.

## Bibliotecas de gráfico (Next.js / RSC) — QUESTÃO EM ABERTO

Não avaliadas por fontes verificadas. Candidatas mencionadas: Recharts, visx, Nivo, Tremor, ECharts.
Falta confirmar quais rodam em RSC vs. exigem `"use client"` e qual serve melhor para heatmap de calendário. **Decidir antes de codar.**

## Questões em aberto (registradas para não fingir que estão resolvidas)
- Identificação de leeches (limiar, suspender vs reformular) — sem fonte primária.
- Libs de gráfico RSC-friendly — sem avaliação verificada.
- Como comunicar backlog sem afogar — sem evidência direta.
- Fórmula fechada do impacto de N novos/dia em FSRS-6 — provável só por simulação.
- Meta diária vs semanal e armadilhas de streak — evidência fraca.

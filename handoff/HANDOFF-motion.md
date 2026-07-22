# Handoff — Camada de Vida (Motion System) · MEMORÁVEL / Preceptor

Para o agente Claude Code implementar no repo `flashcards-app` (Next.js + Tailwind 4 + tokens "Editorial Cognition").
Protótipos de referência: `Direções — Variações.dc.html` (turnos 3 e 4), `Preceptor — Desktop.dc.html`, `Preceptor — Mobile.dc.html`, `motion-system.js`.

## 1. Motion System (fundação)

Criar `src/lib/motion/` com tokens exportados e um hook/inicializador de comportamentos.

**Tokens** (ver `motion-system.js` → `MotionSystem.tokens`):
- `spring.soft` — stiffness 120, damping 14, mass 1 → CSS `linear()` amostrado, 550ms. Uso: retorno de press, painéis, morphs.
- `spring.snappy` — stiffness 260, damping 22, mass 0.8 → 380ms. Uso: chips, badges, ripple de estado.
- `press` — scale 0.95, 70ms ease-out (compressão); retorno sempre pelo spring.
- `depth` — tiltMax 7°, shadowLag 16px (sombra dura, offset, SEM blur — Modernist), lift 5px.
- `intensity` — ambient 0.10, focus 0.22 (opacidades do campo/spotlight).
- CSS var global `--spring` (curva linear()) já usada nos protótipos.

**Regra global**: `button { transition: transform 550ms var(--spring) }` + `button:active { scale 0.95..0.96, 70ms }`. Nada clicável fica morto; nada entra com fade genérico.

## 2. Comportamentos (data-attributes ou props)

Implementados em `motion-system.js` (vanilla, WAAPI + rAF, MutationObserver, WeakSet anti-rebind). Portar como hooks React (`useTilt`, `useMagnetic`, `useRipple`, `useSpotlight`, `useAmbientField`) ou manter o observer.

| Comportamento | Atributo | Comportamento | Tech |
|---|---|---|---|
| Tilt com inércia | `data-ms-tilt="6"` | conteúdo segue o cursor (lerp 0.14), sombra/brilho atrasam (lerp 0.05) via `--shx/--shy/--mx/--my` | rAF |
| Magnetismo | `data-ms-magnetic` | atração ≤5px na direção do cursor; solta com spring (WAAPI) | rAF + WAAPI |
| Ripple semântico | `data-ms-ripple="ink\|accent\|danger\|create"` | onda QUADRADA (zero radius): tinta=revisar, contorno accent=errar, preenchimento accent=criar, tracejado=excluir | WAAPI |
| Spotlight | `data-ms-spotlight` | radial-gradient em `--mx/--my`, opacidade via `--spot` | pointermove |
| Campo ambiente | `data-ms-field="repouso\|observando\|raciocinando\|insight"` | grade de pontos em canvas; pausa fora da viewport (IntersectionObserver) | canvas 2D |

Fallbacks: `prefers-reduced-motion` → o script não liga NADA (early return); scroll timeline sem suporte → conteúdo visível estático; View Transitions sem suporte → troca de estado direta (`if (!document.startViewTransition) update()`).

## 3. Componentes e coreografias (referência por demo)

- **Deck físico (4a)** — DeckCell: tilt 6° + sombra dura com inércia + camadas de pilha em parallax (multiplicadores -0.25/-0.5 de `--shx`) + bordas de cartas internas. Abertura = expansão espacial contínua (3c): `document.startViewTransition()` com `view-transition-name` just-in-time só na célula clicada.
- **Flashcard com matéria (4b)** — ReviewCard: preserve-3d com lastro `translateZ(-7px)` (espessura visível no tilt), brilho especular radial em `--mx/--my`, flip rotateY 800ms spring, resposta revelada por MÁSCARA (`clip-path inset` animado, nunca fade), flexão por `:active`.
- **Magnetismo + ripple (4c)** — CTAs de revisão e aprovação: `data-ms-magnetic` + kind semântico no ripple.
- **Morphing de ícones (4d)** — IconMorph: mesmas barras giram + → ✓ (transform, não swap); ✳ → processando (aceleração + régua); salvar ↓ → desfazer ↶ (rotação -315° com troca no meio). Alternativa produção: Rive state machines para a assinatura ✳.
- **Tipografia cinética (4e)** — TermButton (`<button>` real, a11y por teclado): letras em spans com `transition-delay` em cascata (25ms/letra) no hover; clique expande régua de ações in-place (`max-height` spring) e desenha conexão SVG (`stroke-dashoffset`) ao conceito relacionado, com selo quadrado no destino.
- **IA com corpo (4f)** — PreceptorGlyph: state machine `repouso → observando → raciocinando → insight → executa` (glifo: opacidade/breathe/spin/pulse-pop; campo de pontos acompanha). Eventos: `ai:idle`, `ai:context`, `ai:thinking`, `ai:insight`, `ai:done`.
- **Energy trail (4g)** — SaveTrail: path SVG pontilhado liga origem→✳→preview→deck; ao salvar, overlay accent percorre (`stroke-dashoffset` 900ms), glifo acelera, deck pisca e contador incrementa com flip (2a). Evento: `card:saved {sourceEl, deckEl}`.
- **Microcelebração (4h)** — SessionDone: régua imprime (900ms) → número carimba (stamp-in, spring) → selo de streak (700ms) → ✳ uma volta única. Variantes: streak, resgate de backlog, leech dominado. Sem confete.
- **Scroll choreography (4i)** — HistoryList: `animation-timeline: view()` + `animation-range: entry 0% entry 70%`, revelação por clip-path. Progressive enhancement puro.
- **Dock vivo (turnos 1–2 + protótipos)** — tick de varredura 2px em loop 7–8s; ritmos: lento=observa, pulso duplo=insight, contínuo=processa, costura tracejada=reconectando; sugestões proativas rotacionam a cada ~4s com `msg-in`; badge quadrado com ping.

## 4. Tecnologia indicada

- **Motion (Framer Motion)**: gestures, drag, layout/shared elements dentro do React (painel↔focus, fila da oficina).
- **View Transitions API**: navegação deck→lista→revisão→assistente (nomes just-in-time; título/cor/miniatura preservados).
- **CSS `linear()` + masks + scroll timelines**: tudo que for barato (é a maioria — os demos rodam sem lib).
- **Rive**: assinatura ✳ como state machine, se quiserem fidelidade máxima ao corpo da IA.
- **GSAP**: apenas se o trail/morph exigir coreografia com timeline complexa.
- **Three.js/shaders**: NÃO por padrão; só momento excepcional (ex.: celebração de streak longo), montado sob demanda e destruído depois.

## 5. Performance

- Só `transform`/`opacity`/`clip-path` animados; sombras duras (sem blur animado).
- Canvas do campo: pausar fora da viewport (já feito) e em `document.hidden`.
- rAF encerra ao assentar (settle threshold) — nada roda parado.
- Um MutationObserver único; binds com WeakSet.
- Testar em CPU 4× throttle; corte de tilt/campo em `navigator.hardwareConcurrency <= 4` se necessário.

## 6. Eventos → coreografias (mapa)

| Evento do app | Coreografia |
|---|---|
| `review:reveal` | flip com espessura + máscara (4b) |
| `review:rated(1)` | ripple accent + análise em cascata + dock insight |
| `card:accepted` | stamp no botão + flash + trail → deck + contador flip |
| `cards:batchApproved` | trails em stagger 80ms + celebração curta |
| `ai:streaming` | blocos tipográficos imprimem (2c); régua contínua |
| `ai:error/retry` | costura tracejada → régua se recompõe |
| `session:done` | microcelebração (4h) |
| `deck:open` | View Transition da célula (3c/4a) |

## 7. DISSEMINAÇÃO — cada efeito em TODA a experiência

Regra de projeto: nenhum efeito é exclusivo da tela onde nasceu. Abaixo, o mapa completo superfície × efeito. Intensidades sobem um degrau em relação aos protótipos (`intensity.focus 0.22 → 0.30`, tilt 6→8° nos objetos-herói, trail 3px→4px): a app deve parecer viva no primeiro segundo.

### Tilt + sombra com inércia + parallax de pilha (4a)
- **Home**: TODAS as células de deck (tilt 4–8° proporcional à temperatura: quente inclina mais — o calor é físico). O deck urgente ganha pilha com bordas de cartas + spotlight permanente.
- **Deck detail**: o CounterStrip inteiro em tilt raso (2°); cada contador desloca em parallax próprio.
- **Editor**: a prévia do card no aside é um objeto físico (tilt 5° + espessura) — o aluno "segura" o card que está escrevendo.
- **Oficina/fila**: cada card da fila em tilt 4°, pilha crescendo atrás do lote aprovado.
- **Login**: a marca MEMORÁVEL. como placa física com tilt + sombra dura.
- **Painel/stats**: o heatmap de streak com tilt raso; a célula de hoje pulsa.

### Flashcard com matéria: espessura + brilho especular + máscara (4b)
- **Revisão** (principal): flip 800ms + obturador na resposta.
- **Prévia do editor**: a MESMA matéria — flip ao alternar frente/verso, brilho seguindo o cursor.
- **Cards sugeridos no chat**: mini-cards com espessura; aceitar = flip para o verso "✓ criado".
- **Notas do baralho**: hover levanta a linha 2px com sombra dura (a nota é uma ficha física).
- **Cloze no editor**: o chip de ocultação com brilho especular ao passar o cursor.

### Magnetismo + ripple semântico (4c)
- **Global**: TODO botão primário e todo rating é magnético (`data-ms-magnetic`).
- Ripple kinds em toda a app: `ink` = navegar/revisar/abrir; `create` = salvar nota, criar deck, aceitar card, "+ Novo baralho"; `accent` = Errei, leech, alertas de qualidade; `danger` = excluir, suspender, descartar.
- **Tabs do editor**, seletor Dúvida/Oficina, segmented de profundidade: ripple `ink` + deslize da tinta invertida com spring (não corte).
- **Ratings 1–4**: magnetismo crescente com a urgência (Errei atrai mais — o erro pede atenção).

### Morphing de ícones (4d)
- **"+ Novo baralho"** (home) → ✓ ao criar; **Salvar e continuar** (editor) → ✓ → volta.
- **⋯ dos menus** → × ao abrir (as três esferas colapsam em cruz).
- **✳ do dock** → ▦ ao trocar Dúvida↔Oficina (rotação + troca de geometria).
- **Enviar (Perguntar)** → quadrado de "parar" durante streaming → volta (cancelável sempre visível).
- **Undo**: ↓ salvar → ↶ desfazer em TODOS os toasts com ação.
- **Busca**: lupa → × ao ter query; **tag chip**: + → × no hover de remover.

### Tipografia cinética + conexões (4e)
- **Toda resposta da IA**: termos-`<button>` com cascata de letras; conexões vetoriais entre conceitos confundidos (análise de erro liga "CD" ↔ "circunflexa" com a linha accent).
- **Headlines da home**: entram palavra a palavra com stagger de 30ms (stamp editorial, 1× por sessão).
- **Kickers** (MUITO QUENTE, NOVO, LEECH): letras assentam em cascata ao aparecer.
- **Cloze revelado na revisão**: obturador (2c) + letras da resposta em cascata.
- **Tags no editor**: chip nasce com stamp-in; remover = letras caem 2px e esmaecem.

### IA com corpo + campo ambiente (4f)
- **Dock (todas as páginas)**: glifo com state machine completa; campo de pontos atrás do painel aberto.
- **Home**: campo ambiente sutilíssimo no hero (intensity 0.06), acelera quando o dock tem insight.
- **Revisão**: o campo respira na dor — após "Errei", pontos convergem levemente para o card corretivo sugerido.
- **Focus/Estúdio**: campo em toda a bancada; muda com cada fase (identificando conceitos → estruturando → avaliando).
- **Empty states**: em vez de ilustração morta, o campo de pontos + ✳ observando ("Este baralho está em branco" ganha presença).

### Energy trails (4g)
- **Chat → deck**: criar card a partir da resposta (o principal).
- **Editor**: salvar nota → trail da prévia até o contador "N cards criados" (que flipa).
- **Oficina**: aprovar em lote → trails em stagger de 80ms, um por card, até o nome do deck.
- **Revisão**: card corretivo aceito → trail do bloco de análise até o kicker do deck.
- **Home**: "Recuperar atrasados" → trail do headline até o deck urgente ao clicar.
- **Mover nota entre decks**: trail do menu ⋯ até o toast.

### Microcelebrações (4h)
- **Sessão concluída** (base) + variantes exclusivas: streak N dias (selo maior + régua dupla), backlog zerado ("resgate completo" com as 4 barras de rating imprimindo em sequência), leech dominado (o selo LEECH quebra: as letras caem e o ✓ carimba), primeiro card do dia (✳ meia-volta discreta), deck "esfriou" para Em dia (o kicker ■ vira □ com morph).
- **Editor**: 5º card criado na sessão → contador carimba com pulso.

### Scroll choreography (4i)
- **Histórico do Preceptor**, **índice de notas do baralho** (linhas revelam por máscara), **fila da oficina**, **respostas longas** (blocos entram conforme o scroll), **painel/stats** (heatmap pinta célula a célula ao entrar na viewport), **home** (decks hibernando revelam em cascata).

### Contagem viva (2a) — números NUNCA trocam secos
- Due count da home (decrementa ao vivo se a sessão roda em outra aba), CounterStrip, "N cards criados", contador da fila de revisão, badge do dock, previews de intervalo nos ratings (flipam ao revelar).

### Tick de presença (2b)
- Dock (base), progresso da sessão, borda do painel durante streaming, linha da busca enquanto o FTS roda, régua do editor enquanto a prévia recompila, barra do upload de imagem (costura tracejada ao validar).

## 8. Ordem de implementação sugerida
1. `motion-system.js` global + press/ripple/magnetismo em todos os botões (1 dia, transforma a app inteira).
2. Tilt/matéria nos objetos-herói: deck cells, review card, prévia do editor.
3. Trails + contagem viva (aceite de cards e salvar nota).
4. State machine do ✳ + campo ambiente (dock, painel, empty states).
5. Morphs de ícones + tipografia cinética.
6. Celebrações + scroll choreography.
Cada etapa entrega valor sozinha; nada bloqueia nada.

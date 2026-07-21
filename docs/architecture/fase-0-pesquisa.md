# Fase 0 — Pesquisa de stack (2026-07-21)

Executada por 7 agentes de pesquisa web + 7 verificadores adversariais (fontes primárias: npm registry, GitHub releases/tags/código-fonte, docs oficiais). Nenhuma alegação material foi refutada; as correções encontradas (imprecisões de nuance) estão anotadas em cada digest.

Digests completos por tópico (com fontes e correções) em [`research/`](research/):

| Tópico | Arquivo | Conclusões que viraram decisão |
|---|---|---|
| Next.js / Auth.js / UI | [next-auth-ui.txt](research/next-auth-ui.txt) | Next 16.2.10; Auth.js v5 segue beta e em manutenção (risco R11); `proxy.ts`; `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`; shadcn com Base UI default |
| Drizzle + RLS | [drizzle-rls.txt](research/drizzle-rls.txt) | pgPolicy nativo; `push` proibido para policies; padrão `set_config(...,true)` em transação; adapter Auth.js em instância admin; driver `pg` |
| FSRS | [fsrs.txt](research/fsrs.txt) | ts-fsrs 5.4.1 = FSRS-6/21 params; learning steps nativos; otimizador `@open-spaced-repetition/binding` MIT; true retention à moda Anki |
| pg-boss + pgvector | [jobs-vector.txt](research/jobs-vector.txt) | pg-boss 12.26.1 (breaking v10→v12 mapeados); pgvector 0.8.5 via PGDG; busca exata antes de ANN; armadilha over-filtering HNSW |
| Tiptap | [tiptap.txt](research/tiptap.txt) | v3.28.0; FileHandler/Mathematics viraram MIT; static-renderer; cloze como node inline custom; katex 0.17.x; gotchas mobile |
| OpenAI + AI SDK | [ai-sdk.txt](research/ai-sdk.txt) | AI SDK 7 + Responses API default; gpt-5.4-mini (fast) / gpt-5.6-terra (deep); text-embedding-3-small; SSE atrás de Nginx |
| Object Storage Magalu | [magalu-storage.txt](research/magalu-storage.txt) | presigned só GET/PUT; CORS via mgc CLI; sem lifecycle/eventos; pin @aws-sdk 3.677.0 (aws-chunked); preços e limites |

A matriz de versões consolidada está em [fase-0-diagnostico.md](fase-0-diagnostico.md) §4; as decisões derivadas, em [fase-0-arquitetura.md](fase-0-arquitetura.md) §11.

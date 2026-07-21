# Flashcards (nome provisório)

Aplicação web de flashcards inteligentes com revisão espaçada (FSRS), criação assistida por IA e comunidade — Next.js + PostgreSQL, self-hosted no servidor Magalu.

**Estado atual: Fase 0 (auditoria e planejamento) concluída. Nenhum código de aplicação ainda.**

## Documentos da Fase 0

1. [Diagnóstico de repositório e infraestrutura](docs/architecture/fase-0-diagnostico.md) — servidor, Postgres, Nginx, deploy, matriz de versões.
2. [Arquitetura proposta](docs/architecture/fase-0-arquitetura.md) — módulos, ERD, formato de conteúdo, cloze, RLS, FSRS, temperatura, IA, mídia, decisões e riscos.
3. [Plano de fases](docs/architecture/fase-0-plano.md) — Fases 1–7 com critérios de aceite, estratégia de testes e de migração/rollback.
4. [Pesquisa de stack](docs/architecture/fase-0-pesquisa.md) — versões e compatibilidades verificadas em fontes primárias (2026-07-21).

## Identidade provisória

- Diretório/base/role: `flashcards`
- Porta: 3060 (web) — worker sem porta
- Subdomínio sugerido: `flashcards.mnrs.com.br`

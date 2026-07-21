-- Fase 2: FORCE RLS + grants de media_references (mesma convenção da 0001).
-- Toda migration que cria tabela traz FORCE RLS + grants + caso na suite RLS.

ALTER TABLE "media_references" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "media_references" TO flashcards_app;
--> statement-breakpoint

-- Jobs de sistema (validação de upload, thumbnail, GC de mídia órfã) mudam
-- status de assets e varrem referências sem contexto de usuário.
GRANT SELECT ON "media_references" TO flashcards_service;
--> statement-breakpoint
GRANT UPDATE, DELETE ON "media_assets" TO flashcards_service;
--> statement-breakpoint
GRANT DELETE ON "media_references" TO flashcards_service;

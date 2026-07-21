import { pgRole } from "drizzle-orm/pg-core";

// Roles são criados pelo setup-database.sql (exigem superusuário p/ BYPASSRLS);
// .existing() impede o drizzle-kit de tentar gerenciá-los.
export const appRole = pgRole("flashcards_app").existing();
export const serviceRole = pgRole("flashcards_service").existing();

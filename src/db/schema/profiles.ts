import { integer, pgTable, real, smallint, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { createdAt, ownerPolicy, updatedAt } from "./helpers";

export const userProfiles = pgTable(
  "user_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name"),
    timezone: text("timezone").notNull().default("America/Sao_Paulo"),
    locale: text("locale").notNull().default("pt-BR"),
    // Corte do "dia de estudo" (arquitetura §7.4): convenção única para limites,
    // métricas, dashboard e otimizador FSRS.
    dayStartHour: smallint("day_start_hour").notNull().default(4),
    onboardingCompletedAt: timestamp("onboarding_completed_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [ownerPolicy("user_profiles_owner", t.userId)],
);

export const userPreferences = pgTable(
  "user_preferences",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    desiredRetention: real("desired_retention").notNull().default(0.9),
    newCardsPerDay: integer("new_cards_per_day").notNull().default(20),
    maxReviewsPerDay: integer("max_reviews_per_day").notNull().default(200),
    reviewOrder: text("review_order").notNull().default("mixed"),
    theme: text("theme").notNull().default("system"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [ownerPolicy("user_preferences_owner", t.userId)],
);

import { sql } from "drizzle-orm";
import {
  bigserial,
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { cards } from "./content";
import { createdAt, ownerPolicy, updatedAt } from "./helpers";

export const progressState = pgEnum("progress_state", [
  "new",
  "learning",
  "review",
  "relearning",
]);

export const reviewOrigin = pgEnum("review_origin", ["web", "undo", "import"]);
export const sessionKind = pgEnum("session_kind", ["review", "cram", "rescue"]);
export const fsrsProfileSource = pgEnum("fsrs_profile_source", ["default", "optimized"]);

export const cardProgress = pgTable(
  "card_progress",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    state: progressState("state").notNull().default("new"),
    dueAt: timestamp("due_at", { mode: "date", withTimezone: true }),
    lastReviewedAt: timestamp("last_reviewed_at", { mode: "date", withTimezone: true }),
    // float8: o ts-fsrs opera em float64 — `real` truncaria e divergiria da referência.
    stability: doublePrecision("stability").notNull().default(0),
    difficulty: doublePrecision("difficulty").notNull().default(0),
    // Informativos (deprecated no ts-fsrs) — nunca fonte de lógica; derivar de timestamps.
    elapsedDays: integer("elapsed_days").notNull().default(0),
    scheduledDays: integer("scheduled_days").notNull().default(0),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    learningStep: integer("learning_step").notNull().default(0),
    suspendedAt: timestamp("suspended_at", { mode: "date", withTimezone: true }),
    buriedUntil: timestamp("buried_until", { mode: "date", withTimezone: true }),
    fsrsVersion: text("fsrs_version").notNull().default("ts-fsrs-5/FSRS-6"),
    parametersVersion: integer("parameters_version").notNull().default(1),
    desiredRetention: real("desired_retention"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.cardId] }),
    // Fila de revisão: parcial excluindo suspensos e novos.
    index("card_progress_due_idx")
      .on(t.userId, t.dueAt)
      .where(sql`${t.suspendedAt} IS NULL AND ${t.state} <> 'new'`),
    ownerPolicy("card_progress_owner", t.userId),
  ],
);

export const reviewLogs = pgTable(
  "review_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    // FK real para study_sessions entra na Fase 3.
    studySessionId: uuid("study_session_id"),
    reviewedAt: timestamp("reviewed_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    clientReviewedAt: timestamp("client_reviewed_at", { mode: "date", withTimezone: true }),
    clientTimezone: text("client_timezone"),
    // Nullable somente em origin='undo' (CHECK abaixo).
    rating: smallint("rating"),
    stateBefore: progressState("state_before").notNull(),
    stateAfter: progressState("state_after").notNull(),
    dueBefore: timestamp("due_before", { mode: "date", withTimezone: true }),
    dueAfter: timestamp("due_after", { mode: "date", withTimezone: true }),
    stabilityBefore: doublePrecision("stability_before").notNull(),
    stabilityAfter: doublePrecision("stability_after").notNull(),
    difficultyBefore: doublePrecision("difficulty_before").notNull(),
    difficultyAfter: doublePrecision("difficulty_after").notNull(),
    learningStepBefore: integer("learning_step_before").notNull(),
    learningStepAfter: integer("learning_step_after").notNull(),
    repsBefore: integer("reps_before").notNull(),
    lapsesBefore: integer("lapses_before").notNull(),
    elapsedDays: integer("elapsed_days").notNull().default(0),
    scheduledDaysBefore: integer("scheduled_days_before").notNull().default(0),
    scheduledDaysAfter: integer("scheduled_days_after").notNull().default(0),
    retrievability: real("retrievability"),
    durationMs: integer("duration_ms"),
    sessionKind: sessionKind("session_kind").notNull().default("review"),
    fsrsVersion: text("fsrs_version").notNull(),
    parametersVersion: integer("parameters_version").notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    origin: reviewOrigin("origin").notNull().default("web"),
    // Obrigatório em origin='undo': aponta o log desfeito (regra de consumo:
    // otimizador/estatísticas excluem undo E os logs referenciados).
    revertedLogId: bigint("reverted_log_id", { mode: "number" }).references(
      (): AnyPgColumn => reviewLogs.id,
    ),
  },
  (t) => [
    uniqueIndex("review_logs_idempotency_uq").on(t.userId, t.idempotencyKey),
    index("review_logs_user_reviewed_idx").on(t.userId, t.reviewedAt.desc()),
    index("review_logs_card_reviewed_idx").on(t.cardId, t.reviewedAt.desc()),
    check(
      "review_logs_rating_check",
      sql`(${t.origin} = 'undo' AND ${t.rating} IS NULL AND ${t.revertedLogId} IS NOT NULL) OR (${t.origin} <> 'undo' AND ${t.rating} BETWEEN 1 AND 4)`,
    ),
    ownerPolicy("review_logs_owner", t.userId),
  ],
);

export const fsrsProfiles = pgTable(
  "fsrs_profiles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    // Array w de 21 parâmetros (FSRS-6) — cru, migrável pelo generatorParameters.
    parameters: jsonb("parameters").notNull(),
    desiredRetention: real("desired_retention").notNull().default(0.9),
    source: fsrsProfileSource("source").notNull().default("default"),
    metrics: jsonb("metrics"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.version] }),
    ownerPolicy("fsrs_profiles_owner", t.userId),
  ],
);

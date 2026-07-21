import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { createdAt, ownerPolicy, updatedAt } from "./helpers";

export const deckStatus = pgEnum("deck_status", [
  "active",
  "maintenance",
  "completed",
  "paused",
  "archived",
]);

export const deckVisibility = pgEnum("deck_visibility", ["private", "unlisted", "public"]);

export const decks = pgTable(
  "decks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: deckStatus("status").notNull().default("active"),
    visibility: deckVisibility("visibility").notNull().default("private"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { mode: "date", withTimezone: true }),
  },
  (t) => [
    index("decks_owner_status_idx").on(t.ownerUserId, t.status),
    ownerPolicy("decks_owner", t.ownerUserId),
  ],
);

export const deckSettings = pgTable(
  "deck_settings",
  {
    deckId: uuid("deck_id")
      .primaryKey()
      .references(() => decks.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    desiredRetentionOverride: real("desired_retention_override"),
    newPerDayOverride: integer("new_per_day_override"),
    maxReviewsPerDayOverride: integer("max_reviews_per_day_override"),
    suggestionsEnabled: boolean("suggestions_enabled").notNull().default(true),
    weeklyNewCardsGoal: integer("weekly_new_cards_goal"),
    examDate: date("exam_date"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [ownerPolicy("deck_settings_owner", t.ownerUserId)],
);

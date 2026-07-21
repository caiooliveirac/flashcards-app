import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { decks } from "./decks";
import { createdAt, ownerPolicy, updatedAt } from "./helpers";

export const noteType = pgEnum("note_type", ["basic", "cloze"]);
export const noteSourceType = pgEnum("note_source_type", ["human", "ai", "import"]);
export const cardStatus = pgEnum("card_status", ["active", "suspended", "removed"]);
export const mediaStatus = pgEnum("media_status", ["pending", "ready", "failed"]);

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deckId: uuid("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    noteType: noteType("note_type").notNull(),
    // Árvore NoteContentV1 validada com Zod na aplicação (nunca HTML).
    contentJson: jsonb("content_json").notNull(),
    contentVersion: integer("content_version").notNull().default(1),
    searchText: text("search_text").notNull().default(""),
    sourceType: noteSourceType("source_type").notNull().default("human"),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // FK real para ai_generations entra na Fase 5 (expand-and-contract).
    aiGenerationId: uuid("ai_generation_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { mode: "date", withTimezone: true }),
  },
  (t) => [
    index("notes_deck_updated_idx").on(t.deckId, t.updatedAt.desc()),
    index("notes_search_idx").using("gin", sql`to_tsvector('portuguese', ${t.searchText})`),
    ownerPolicy("notes_owner", t.ownerUserId),
  ],
);

export const cards = pgTable(
  "cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Contador monotônico por nota (max+1), nunca reutilizado nem posicional.
    variant: integer("variant").notNull(),
    clozeGroupKey: text("cloze_group_key"),
    status: cardStatus("status").notNull().default("active"),
    contentFingerprint: text("content_fingerprint").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("cards_note_variant_uq").on(t.noteId, t.variant),
    index("cards_note_idx").on(t.noteId),
    ownerPolicy("cards_owner", t.ownerUserId),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("tags_owner_name_uq").on(t.ownerUserId, t.name),
    ownerPolicy("tags_owner", t.ownerUserId),
  ],
);

export const noteTags = pgTable(
  "note_tags",
  {
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.noteId, t.tagId] }),
    ownerPolicy("note_tags_owner", t.ownerUserId),
  ],
);

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull().unique(),
    mimeType: text("mime_type"),
    byteSize: bigint("byte_size", { mode: "number" }),
    width: integer("width"),
    height: integer("height"),
    sha256: text("sha256"),
    status: mediaStatus("status").notNull().default("pending"),
    thumbnailKey: text("thumbnail_key"),
    // Fecha o PUT de upload após o confirm (TOCTOU do driver local).
    confirmedAt: timestamp("confirmed_at", { mode: "date", withTimezone: true }),
    // GC mark-and-sweep: carência conta a partir da orfandade OBSERVADA,
    // não do created_at (imagem removida de nota não pode morrer em 1h).
    orphanSeenAt: timestamp("orphan_seen_at", { mode: "date", withTimezone: true }),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at", { mode: "date", withTimezone: true }),
  },
  (t) => [
    index("media_assets_owner_created_idx").on(t.ownerUserId, t.createdAt),
    ownerPolicy("media_assets_owner", t.ownerUserId),
  ],
);

export const mediaReferences = pgTable(
  "media_references",
  {
    mediaAssetId: uuid("media_asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    // Posição do uso dentro da nota (ex.: "front:0", "back:2", "text:1").
    slot: text("slot").notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    altText: text("alt_text"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.mediaAssetId, t.noteId, t.slot] }),
    index("media_references_note_idx").on(t.noteId),
    ownerPolicy("media_references_owner", t.ownerUserId),
  ],
);

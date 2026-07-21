import { bigserial, index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { createdAt, ownerPolicy } from "./helpers";

// Append-only para flashcards_app (grants: INSERT/SELECT, sem UPDATE/DELETE —
// aplicados na migration de grants). Linhas de sistema (actor NULL) são
// inseridas via flashcards_service e invisíveis ao usuário (policy por dono).
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    metadata: jsonb("metadata"),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_actor_created_idx").on(t.actorUserId, t.createdAt.desc()),
    ownerPolicy("audit_logs_owner", t.actorUserId),
  ],
);

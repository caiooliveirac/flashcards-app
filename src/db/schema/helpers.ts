import { sql, type SQL } from "drizzle-orm";
import { pgPolicy, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";
import { appRole } from "./roles";

/**
 * Policy padrão de isolamento por dono para flashcards_app.
 * current_setting(..., true) => NULL quando o GUC não foi setado (default-deny
 * silencioso, sem exceção). flashcards_service tem BYPASSRLS e não precisa de policy.
 */
export function ownerPolicy(name: string, ownerColumn: AnyPgColumn) {
  const expr: SQL = sql`${ownerColumn} = current_setting('app.current_user_id', true)`;
  return pgPolicy(name, {
    as: "permissive",
    for: "all",
    to: appRole,
    using: expr,
    withCheck: expr,
  });
}

export const createdAt = () =>
  timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

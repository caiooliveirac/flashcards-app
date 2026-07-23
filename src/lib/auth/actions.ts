"use server";

import { signOut } from "@/lib/auth";

/**
 * Logout como server action nomeada — client components (menu mobile) não
 * podem declarar actions inline, então importam esta.
 */
export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}

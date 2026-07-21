"use server";

import { revalidatePath } from "next/cache";
import { setUserPassword } from "@/features/admin/service";
import { requireAdmin } from "@/lib/auth/require-admin";

export async function setPasswordAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const targetUserId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "");
  await setUserPassword(session.user.id, targetUserId, password);
  revalidatePath("/admin");
}

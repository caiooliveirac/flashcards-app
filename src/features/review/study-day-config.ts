import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { userProfiles } from "@/db/schema";
import type { StudyDayConfig } from "@/lib/study-day";

/** Config do dia de estudo do usuário (§7.4); default se não houver perfil. */
export async function loadStudyDayConfig(tx: Tx, userId: string): Promise<StudyDayConfig> {
  const [profile] = await tx
    .select({ timezone: userProfiles.timezone, dayStartHour: userProfiles.dayStartHour })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  return {
    timezone: profile?.timezone ?? "America/Sao_Paulo",
    dayStartHour: profile?.dayStartHour ?? 4,
  };
}

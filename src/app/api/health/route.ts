import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/runtime";

export const dynamic = "force-dynamic";

// Commit embutido no `next build` pelo scripts/deploy-magalu.sh (null em dev/CI):
// o deploy.yml espera o público responder com o SHA que liberou.
const commit = process.env.NEXT_PUBLIC_COMMIT_SHA || null;

export async function GET() {
  try {
    await getDb().dbService.execute(sql`SELECT 1`);
    return NextResponse.json({ status: "ok", commit });
  } catch {
    return NextResponse.json({ status: "db_unreachable", commit }, { status: 503 });
  }
}

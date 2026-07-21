import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().dbService.execute(sql`SELECT 1`);
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "db_unreachable" }, { status: 503 });
  }
}

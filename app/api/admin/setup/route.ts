// app/api/admin/setup/route.ts
// TEMPORARY admin route. Runs on Vercel (where IAM/OIDC auth to Aurora works).
// Does two things in one deploy:
//   1. Adds 'dependencies' to the analysis_mode enum (idempotent)
//   2. Returns the list of estates (id + name) so you can open /estate/<id>
// DELETE this file after you've used it.
import { db, pool } from "@/lib/db";
import { estate } from "@/lib/db/schema";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // 1. additive enum migration — safe to run repeatedly
    await pool.query(
      "ALTER TYPE analysis_mode ADD VALUE IF NOT EXISTS 'dependencies'",
    );

    // 2. list estates
    const rows = await db.select().from(estate);

    return NextResponse.json({
      migrated: "analysis_mode now includes 'dependencies'",
      estates: rows,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "setup failed" },
      { status: 500 },
    );
  }
}
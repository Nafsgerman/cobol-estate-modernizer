// app/api/admin/setup/route.ts
// TEMPORARY admin/diagnostic route. DELETE after use.
// Shows each program's source length so we can see if COBOL bodies were seeded.
import { db, pool } from "@/lib/db";
import { estate, program } from "@/lib/db/schema";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    // ensure enum migration (idempotent)
    await pool.query(
      "ALTER TYPE analysis_mode ADD VALUE IF NOT EXISTS 'dependencies'",
    );

    const estates = await db.select().from(estate);
    const programs = await db.select().from(program);

    // the key diagnostic: source length per program
    const programSourceReport = programs.map((p) => ({
      programId: p.programId,
      id: p.id,
      hasSource: Boolean(p.source && p.source.length > 0),
      sourceLength: p.source?.length ?? 0,
      lineCount: p.lineCount,
    }));

    return NextResponse.json({
      estates,
      programSourceReport,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "setup failed" },
      { status: 500 },
    );
  }
}

// app/api/estate/[id]/programs/[programId]/source/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { program } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; programId: string }> },
) {
  const { id: estateId, programId } = await params;

  let source: string;
  try {
    ({ source } = await req.json());
    if (!source?.trim()) throw new Error("empty");
  } catch {
    return NextResponse.json({ error: "source is required" }, { status: 400 });
  }

  try {
    const rows = await db
      .update(program)
      .set({ source })
      .where(and(eq(program.id, programId), eq(program.estateId, estateId)))
      .returning({ id: program.id });

    if (rows.length === 0) {
      return NextResponse.json({ error: "Program not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, id: rows[0].id });
  } catch (err) {
    console.error(`[PATCH /programs/${programId}/source] failed:`, err);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

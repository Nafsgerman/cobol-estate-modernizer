"use server";

// =============================================================================
// app/actions/estate-write.ts — the write path that turns a pasted program into
// a persisted estate node. This is what makes the playground and the estate one
// product: analyze a program, then commit it to Aurora, where the recursive CTE
// immediately re-derives its call chain and any cycles it closes.
//
// Idempotent: upsert on (estate_id, program_id) so re-saving the same program
// updates its source instead of duplicating. Call edges are wired in BOTH
// directions from the static CALL statements — this program's calls out to
// existing programs, and existing programs that call in to this one — so adding
// the second half of a mutually-recursive pair lights the cycle ring at once.
// =============================================================================
import { eq } from "drizzle-orm";
import { db, withDbRetry } from "@/lib/db";
import { program, dependency } from "@/lib/db/schema";
import { extractProgramId, extractCallTargets } from "@/lib/cobol/extract";
import { checkCobolSyntax } from "@/lib/cobol/syntax";

export interface SaveResult {
  ok: boolean;
  programId?: string; // uuid of the saved program
  programName?: string; // PROGRAM-ID
  edgesOut?: number; // calls this program makes to existing programs
  edgesIn?: number; // existing programs that call this one
  error?: string;
}

export async function saveProgramToEstate(
  estateId: string,
  source: string,
): Promise<SaveResult> {
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, error: "No source to save." };

  const name = extractProgramId(trimmed);
  if (!name)
    return {
      ok: false,
      error: "No PROGRAM-ID found — can't name this program in the estate.",
    };

  // Structural errors block the save (warnings like missing STOP RUN are fine).
  const errors = checkCobolSyntax(trimmed).filter((e) => e.severity === "error");
  if (errors.length > 0)
    return {
      ok: false,
      error: `Fix ${errors.length} structural error${
        errors.length === 1 ? "" : "s"
      } before saving — e.g. ${errors[0].message}.`,
    };

  try {
    // Upsert the program node (idempotent on estate_id + program_id).
    const [row] = await withDbRetry(() =>
      db
        .insert(program)
        .values({ estateId, programId: name, source: trimmed })
        .onConflictDoUpdate({
          target: [program.estateId, program.programId],
          set: { source: trimmed },
        })
        .returning({ id: program.id }),
    );
    const programUuid = row.id;

    // Snapshot every program in the estate (name → id, plus source for inbound).
    const all = await withDbRetry(() =>
      db
        .select({
          id: program.id,
          name: program.programId,
          source: program.source,
        })
        .from(program)
        .where(eq(program.estateId, estateId)),
    );
    const byName = new Map<string, string>(all.map((row) => [row.name.toUpperCase(), row.id]));

    // Outbound: this program CALLs → existing programs.
    const outTargets = extractCallTargets(trimmed).filter(
      (t) => byName.has(t) && byName.get(t) !== programUuid,
    );
    // Inbound: existing programs whose source CALLs this program.
    const inboundIds: string[] = [];
    for (const p of all) {
      if (p.id === programUuid || !p.source) continue;
      if (extractCallTargets(p.source).includes(name)) inboundIds.push(p.id);
    }

    type DepInsert = typeof dependency.$inferInsert;
    const edgeRows: DepInsert[] = [
      ...outTargets.map((t) => ({
        estateId,
        sourceType: "program" as const,
        sourceId: programUuid,
        targetType: "program" as const,
        targetId: byName.get(t)!,
        kind: "call" as const,
      })),
      ...inboundIds.map((sid) => ({
        estateId,
        sourceType: "program" as const,
        sourceId: sid,
        targetType: "program" as const,
        targetId: programUuid,
        kind: "call" as const,
      })),
    ];

    if (edgeRows.length > 0) {
      // UNIQUE(estate_id, source_type, source_id, target_type, target_id, kind)
      // makes re-saving safe — duplicate edges are silently ignored.
      await withDbRetry(() =>
        db.insert(dependency).values(edgeRows).onConflictDoNothing(),
      );
    }

    return {
      ok: true,
      programId: programUuid,
      programName: name,
      edgesOut: outTargets.length,
      edgesIn: inboundIds.length,
    };
  } catch (err) {
    console.error(`[estate-write:${name}] save failed:`, err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Save failed.",
    };
  }
}

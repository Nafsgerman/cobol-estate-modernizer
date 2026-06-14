"use server";

// =============================================================================
// app/actions/estate-source.ts — update a program's source in Aurora.
// Runs triage first; only persists if verdict is clean or cosmetic.
// Blocking source is rejected — same gate as the playground.
// =============================================================================
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { program } from "@/lib/db/schema";
import { triageSource, type TriageResult } from "@/lib/ai/triage";

export interface UpdateSourceResult {
  ok: boolean;
  triage: TriageResult;
  error?: string;
}

export async function updateProgramSource(
  programId: string,
  source: string,
): Promise<UpdateSourceResult> {
  const triage = await triageSource(source);

  if (triage.verdict === "blocking") {
    return { ok: false, triage, error: "Source has blocking syntax errors — fix before saving." };
  }

  const trimmed = source.trim();
  const lineCount = trimmed.split("\n").length;

  await db
    .update(program)
    .set({ source: trimmed, lineCount })
    .where(eq(program.id, programId));

  return { ok: true, triage };
}
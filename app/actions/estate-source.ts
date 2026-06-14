"use server";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { program } from "@/lib/db/schema";
import { triageSource, type TriageResult } from "@/lib/ai/triage";
import { sql } from "drizzle-orm";

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

  // Verify the write landed — read back immediately
  const [updated] = await db
    .select({ id: program.id, lineCount: program.lineCount })
    .from(program)
    .where(eq(program.id, programId));

  if (!updated) {
    return { ok: false, triage, error: "Write verification failed — program not found." };
  }

  return { ok: true, triage };
}
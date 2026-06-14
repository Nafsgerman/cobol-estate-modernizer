// =============================================================================
// lib/cobol/extract.ts — structural extraction for the estate write path.
// Pulls the PROGRAM-ID (the node's name) and static CALL targets (the call
// edges) out of raw COBOL. Comment lines are stripped first so a CALL inside a
// comment never produces a phantom edge. Only *literal* calls — CALL 'NAME' /
// CALL "NAME" — are resolved; dynamic CALL identifier targets can't be known
// statically and are intentionally skipped.
// =============================================================================

/** Drop COBOL comment lines: full-line '*' or fixed-format '*' in column 7. */
function stripComments(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (t.startsWith("*")) return false; // free-format / whole-line comment
      if (line.length > 6 && line[6] === "*") return false; // fixed col-7 comment
      return true;
    })
    .join("\n");
}

/** PROGRAM-ID paragraph → the program name (upper-cased), or null if absent. */
export function extractProgramId(source: string): string | null {
  const m = stripComments(source).match(
    /PROGRAM-ID\s*\.?\s*([A-Za-z0-9][A-Za-z0-9-]*)/i,
  );
  return m ? m[1].toUpperCase() : null;
}

/** Distinct static CALL targets (upper-cased). Literal calls only. */
export function extractCallTargets(source: string): string[] {
  const clean = stripComments(source);
  const targets = new Set<string>();
  const re = /\bCALL\s+["']([A-Za-z0-9][A-Za-z0-9-]*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) targets.add(m[1].toUpperCase());
  return [...targets];
}

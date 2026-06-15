import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "../lib/db";
import {
  estate,
  program,
  dependency,
} from "../lib/db/schema";

const ESTATE_NAME = "Acme Payroll Estate";
const ESTATE_DESC =
  "Demo estate: billing, reconciliation, and payroll ledger programs. " +
  "Includes a deliberate RECONA↔RECONB mutual recursion cycle.";

const PROGRAMS = [
  { key: "BILMAIN",  programId: "BILMAIN",  isSubprogram: false, lineCount: 420 },
  { key: "PAYLEDGR", programId: "PAYLEDGR", isSubprogram: false, lineCount: 310 },
  { key: "RECONA",   programId: "RECONA",   isSubprogram: true,  lineCount: 280 },
  { key: "RECONB",   programId: "RECONB",   isSubprogram: true,  lineCount: 265 },
  { key: "RPTGEN",   programId: "RPTGEN",   isSubprogram: true,  lineCount: 190 },
  { key: "DBWRITE",  programId: "DBWRITE",  isSubprogram: true,  lineCount: 155 },
];

const EDGES: [string, string][] = [
  ["BILMAIN",  "RECONA"],
  ["BILMAIN",  "RPTGEN"],
  ["BILMAIN",  "PAYLEDGR"],
  ["RECONA",   "RECONB"],
  ["RECONB",   "RECONA"],
  ["RPTGEN",   "DBWRITE"],
];

async function main() {
  console.log("Seeding estate…");

  const [e] = await db
    .insert(estate)
    .values({ name: ESTATE_NAME, description: ESTATE_DESC })
    .onConflictDoNothing()
    .returning();

  if (!e) {
    console.log("Estate already exists — skipping full seed.");
    await pool.end();
    return;
  }

  const estateId = e.id;
  console.log("Estate:", estateId);

  const rows = await db
    .insert(program)
    .values(PROGRAMS.map((p) => ({ estateId, ...p, key: undefined })))
    .returning({ id: program.id, programId: program.programId });

  const idMap = new Map(rows.map((r) => [r.programId, r.id]));

  const edgeValues = EDGES.map(([src, tgt]) => ({
    estateId,
    sourceType: "program" as const,
    sourceId: idMap.get(src)!,
    targetType: "program" as const,
    targetId: idMap.get(tgt)!,
    kind: "call" as const,
  }));

  await db.insert(dependency).values(edgeValues).onConflictDoNothing();

  console.log(`Seeded ${PROGRAMS.length} programs, ${EDGES.length} edges.`);
  console.log("Estate ID (save this):", estateId);
  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
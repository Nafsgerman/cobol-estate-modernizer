import { db, pool, type schema } from "../lib/db";
import { estate, program, dependency } from "../lib/db/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

const PROGRAM_COUNT = 500;
const RANDOM_EDGES = 2000;

function rnd(n: number) {
  return Math.floor(Math.random() * n);
}

export interface SeedLargeResult {
  estateId: string;
  programs: number;
  edges: number;
}

export async function seedLargeEstate(
  database: NodePgDatabase<typeof schema>,
): Promise<SeedLargeResult> {
  const [e] = await database
    .insert(estate)
    .values({
      name: "Large Stress Estate",
      description:
        "500-program synthetic COBOL estate for recursive CTE benchmarking.",
    })
    .returning();

  const estateId = e.id;

  const keys: string[] = Array.from({ length: PROGRAM_COUNT }, (_, i) =>
    "PROG" + String(i).padStart(4, "0"),
  );

  const allPrograms: { id: string }[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100);
    const inserted = await database
      .insert(program)
      .values(
        batch.map((key, j) => ({
          estateId,
          programId: key,
          isSubprogram: (i + j) % 3 !== 0,
          lineCount: 100 + rnd(900),
        })),
      )
      .returning({ id: program.id });
    allPrograms.push(...inserted);
  }

  const edgeSet = new Set<string>();
  const edges: {
    estateId: string;
    sourceType: "program";
    sourceId: string;
    targetType: "program";
    targetId: string;
    kind: "call";
  }[] = [];

  while (edges.length < RANDOM_EDGES) {
    const src = rnd(PROGRAM_COUNT);
    const tgt = rnd(PROGRAM_COUNT);
    if (src === tgt) continue;
    const k = src + "-" + tgt;
    if (edgeSet.has(k)) continue;
    edgeSet.add(k);
    edges.push({
      estateId,
      sourceType: "program",
      sourceId: allPrograms[src].id,
      targetType: "program",
      targetId: allPrograms[tgt].id,
      kind: "call",
    });
  }

  for (let i = 0; i < edges.length; i += 200) {
    await database
      .insert(dependency)
      .values(edges.slice(i, i + 200))
      .onConflictDoNothing();
  }

  return { estateId, programs: allPrograms.length, edges: edges.length };
}

async function main() {
  await import("dotenv/config");
  console.log("Seeding large estate…");
  const result = await seedLargeEstate(db);
  console.log("Inserted " + result.programs + " programs");
  console.log("Inserted " + result.edges + " edges");
  console.log("Estate ID:", result.estateId);
  await pool.end();
}

if (process.argv[1] && process.argv[1].endsWith("seed-large.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

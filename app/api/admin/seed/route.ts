import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";

export const maxDuration = 60;

export async function POST() {
  try {
    const { estate, program, dependency } = schema;

    // Clear demo data (cascade handles children)
    await db.delete(estate);

    // Insert estate
    const [e] = await db.insert(estate).values({
      name: "Billing System",
      description: "Legacy COBOL billing estate — demo with deliberate A↔B call cycle",
    }).returning();

    // Insert programs
    const programs = await db.insert(program).values([
      { estateId: e.id, programId: "BILMAIN", isSubprogram: false, lineCount: 420 },
      { estateId: e.id, programId: "RECONA",  isSubprogram: true,  lineCount: 180 },
      { estateId: e.id, programId: "RECONB",  isSubprogram: true,  lineCount: 175 },
      { estateId: e.id, programId: "RPTGEN",  isSubprogram: true,  lineCount: 310 },
      { estateId: e.id, programId: "DBWRITE", isSubprogram: true,  lineCount: 95  },
    ]).returning();

    const p = Object.fromEntries(programs.map(x => [x.programId, x]));

    // Insert dependency edges (program→program via dependency table, sourceType/targetType = 'program')
    await db.insert(dependency).values([
      { estateId: e.id, sourceType: "program", sourceId: p.BILMAIN.id, targetType: "program", targetId: p.RECONA.id,  kind: "call" },
      { estateId: e.id, sourceType: "program", sourceId: p.BILMAIN.id, targetType: "program", targetId: p.RPTGEN.id,  kind: "call" },
      { estateId: e.id, sourceType: "program", sourceId: p.RECONA.id,  targetType: "program", targetId: p.RECONB.id,  kind: "call" },
      { estateId: e.id, sourceType: "program", sourceId: p.RECONB.id,  targetType: "program", targetId: p.RECONA.id,  kind: "call" }, // cycle
      { estateId: e.id, sourceType: "program", sourceId: p.RPTGEN.id,  targetType: "program", targetId: p.DBWRITE.id, kind: "call" },
    ]);

    return NextResponse.json({ ok: true, estate: e.name, programs: programs.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

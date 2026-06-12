// db/seed.ts
// Populates one demo estate: a COBOL billing system. Includes a deliberate
// mutually-recursive call pair (RECONA <-> RECONB) so callChainDownstream's
// cycle guard is visibly exercised in the demo.
//
// Run:  DATABASE_URL=... npx tsx db/seed.ts
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import {
  estate, program, copybook, dataElement, analysisRun,
  businessRule, businessRuleDataElement, ticket, dependency,
} from './schema';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main() {
  // --- fresh estate (idempotent: wipe any prior demo estate by name) --------
  await db.delete(estate).where(eq(estate.name, 'ACME Billing (demo)'));
  const [est] = await db.insert(estate).values({
    name: 'ACME Billing (demo)',
    description: 'Legacy COBOL billing estate — seeded for the H0 demo.',
  }).returning();
  const E = est.id;

  // --- programs -------------------------------------------------------------
  const progDefs = [
    { program_id: 'MAINBILL', filename: 'mainbill.cbl', is_subprogram: false, line_count: 1240 },
    { program_id: 'VALIDCUST', filename: 'validcust.cbl', is_subprogram: true, line_count: 410 },
    { program_id: 'CALCTAX',  filename: 'calctax.cbl',  is_subprogram: true, line_count: 380 },
    { program_id: 'APPLYDISC', filename: 'applydisc.cbl', is_subprogram: true, line_count: 295 },
    { program_id: 'POSTLEDG', filename: 'postledg.cbl', is_subprogram: true, line_count: 520 },
    { program_id: 'TAXRULE',  filename: 'taxrule.cbl',  is_subprogram: true, line_count: 160 },
    { program_id: 'DISCRULE', filename: 'discrule.cbl', is_subprogram: true, line_count: 140 },
    { program_id: 'LEDGWRITE', filename: 'ledgwrite.cbl', is_subprogram: true, line_count: 230 },
    { program_id: 'RECONA',   filename: 'recona.cbl',   is_subprogram: true, line_count: 200 },
    { program_id: 'RECONB',   filename: 'reconb.cbl',   is_subprogram: true, line_count: 210 },
  ];
  const progs = await db.insert(program)
    .values(progDefs.map(p => ({ estateId: E, ...p })))
    .returning();
  const P = Object.fromEntries(progs.map(p => [p.programId, p.id])) as Record<string, string>;

  // --- copybooks ------------------------------------------------------------
  const cbs = await db.insert(copybook).values([
    { estateId: E, name: 'CUSTREC' },
    { estateId: E, name: 'ACCTREC' },
  ]).returning();
  const C = Object.fromEntries(cbs.map(c => [c.name, c.id])) as Record<string, string>;

  // --- data elements (CUSTREC hierarchy) ------------------------------------
  const [custRoot] = await db.insert(dataElement).values({
    estateId: E, copybookId: C['CUSTREC'], levelNumber: 1, name: 'CUST-RECORD',
  }).returning();
  const custKids = await db.insert(dataElement).values([
    { estateId: E, copybookId: C['CUSTREC'], parentId: custRoot.id, levelNumber: 5, name: 'CUST-ID', picture: '9(8)', usage: 'DISPLAY' },
    { estateId: E, copybookId: C['CUSTREC'], parentId: custRoot.id, levelNumber: 5, name: 'CUST-NAME', picture: 'X(30)', usage: 'DISPLAY' },
    { estateId: E, copybookId: C['CUSTREC'], parentId: custRoot.id, levelNumber: 5, name: 'CUST-BALANCE', picture: 'S9(9)V99', usage: 'COMP-3' },
    { estateId: E, copybookId: C['CUSTREC'], parentId: custRoot.id, levelNumber: 5, name: 'CUST-STATUS', picture: 'X(1)', usage: 'DISPLAY' },
  ]).returning();
  const custStatus = custKids.find(d => d.name === 'CUST-STATUS')!;
  await db.insert(dataElement).values([
    { estateId: E, copybookId: C['CUSTREC'], parentId: custStatus.id, levelNumber: 88, name: 'CUST-ACTIVE', value: "'A'" },
    { estateId: E, copybookId: C['CUSTREC'], parentId: custStatus.id, levelNumber: 88, name: 'CUST-CLOSED', value: "'C'" },
  ]);
  const custBalance = custKids.find(d => d.name === 'CUST-BALANCE')!;

  // --- dependency edges -----------------------------------------------------
  const call = (src: string, tgt: string) => ({
    estateId: E, sourceType: 'program' as const, sourceId: P[src],
    targetType: 'program' as const, targetId: P[tgt], kind: 'call' as const,
  });
  const copy = (src: string, cb: string) => ({
    estateId: E, sourceType: 'program' as const, sourceId: P[src],
    targetType: 'copybook' as const, targetId: C[cb], kind: 'copy' as const,
  });
  await db.insert(dependency).values([
    call('MAINBILL', 'VALIDCUST'), call('MAINBILL', 'CALCTAX'),
    call('MAINBILL', 'APPLYDISC'), call('MAINBILL', 'POSTLEDG'),
    call('MAINBILL', 'RECONA'),
    call('CALCTAX', 'TAXRULE'), call('APPLYDISC', 'DISCRULE'),
    call('POSTLEDG', 'LEDGWRITE'),
    call('RECONA', 'RECONB'), call('RECONB', 'RECONA'), // cycle guard target
    copy('MAINBILL', 'CUSTREC'), copy('VALIDCUST', 'CUSTREC'),
    copy('POSTLEDG', 'ACCTREC'),
  ]);

  // --- analysis run (lineage source for the rules below) --------------------
  const [run] = await db.insert(analysisRun).values({
    estateId: E, programId: P['VALIDCUST'], mode: 'extract', status: 'complete',
    model: 'claude-opus-4-8', promptTokens: 4120, completionTokens: 880,
    finishedAt: new Date(),
  }).returning();

  // --- business rules (traced back to the run) ------------------------------
  const rules = await db.insert(businessRule).values([
    { estateId: E, programId: P['VALIDCUST'], runId: run.id, category: 'validation',
      statement: 'A customer must have status ACTIVE before any invoice is generated.',
      location: 'VALIDCUST §2100-CHECK-STATUS', confidence: '0.94' },
    { estateId: E, programId: P['VALIDCUST'], runId: run.id, category: 'validation',
      statement: 'Outstanding balance above the credit limit blocks new charges.',
      location: 'VALIDCUST §2300-CREDIT-CHECK', confidence: '0.88' },
    { estateId: E, programId: P['CALCTAX'], category: 'calculation',
      statement: 'Tax is applied per jurisdiction code resolved by TAXRULE.',
      location: 'CALCTAX §3000-APPLY-TAX', confidence: '0.91' },
  ]).returning();

  // link the two VALIDCUST rules to the fields they touch
  await db.insert(businessRuleDataElement).values([
    { ruleId: rules[0].id, dataElementId: custStatus.id },
    { ruleId: rules[1].id, dataElementId: custBalance.id },
  ]);

  // --- tickets --------------------------------------------------------------
  await db.insert(ticket).values([
    { estateId: E, programId: P['RECONA'], runId: run.id, kind: 'risk', priority: 'high',
      title: 'Break RECONA↔RECONB recursion before re-platforming',
      body: 'Mutually recursive CALL cycle complicates a straight port; needs a guard or redesign.' },
    { estateId: E, programId: P['CALCTAX'], kind: 'document', priority: 'medium',
      title: 'Document jurisdiction tax matrix used by TAXRULE' },
  ]);

  console.log(`Seeded estate ${E}: ${progs.length} programs, ${cbs.length} copybooks, ${rules.length} rules.`);
  await pool.end();
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });

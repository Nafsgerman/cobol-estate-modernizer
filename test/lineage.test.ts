// test/lineage.test.ts
// Proves the recursive call-chain traversal is correct AND terminates on a
// cyclic COBOL call graph — the guarantee ADR 0005 claims.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './setup/pg-harness';
import {
  estate, program, dependency,
} from '../lib/db/schema';
import { callChainDownstream, loadEstateGraph } from '../lib/db/lineage';

let h: Harness;
let estateId: string;
const P: Record<string, string> = {};

beforeAll(async () => {
  h = await startHarness();

  const [e] = await h.db.insert(estate).values({ name: 'cycle-fixture' }).returning();
  estateId = e.id;

  // A -> B -> C, and a mutually recursive pair X <-> Y reachable from A.
  // A also calls X, so traversal from A must enter and survive the X<->Y cycle.
  const defs = ['A', 'B', 'C', 'X', 'Y'].map((n) => ({ estateId, programId: n }));
  const rows = await h.db.insert(program).values(defs).returning();
  for (const r of rows) P[r.programId] = r.id;

  const call = (s: string, t: string) => ({
    estateId, sourceType: 'program' as const, sourceId: P[s],
    targetType: 'program' as const, targetId: P[t], kind: 'call' as const,
  });
  await h.db.insert(dependency).values([
    call('A', 'B'), call('B', 'C'),
    call('A', 'X'), call('X', 'Y'), call('Y', 'X'), // cycle
  ]);
}, 120_000);

afterAll(async () => { await h?.stop(); });

describe('callChainDownstream', () => {
  it('terminates on a cyclic graph and flags the cycle', async () => {
    // The assertion that matters: this call RETURNS. A broken guard hangs until
    // the test timeout. We also bound the result is finite and small.
    const rows = await callChainDownstream(h.db, estateId, P['A']);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(50); // no runaway expansion

    const cycleRows = rows.filter((r) => r.is_cycle);
    expect(cycleRows.length).toBeGreaterThan(0); // X<->Y detected
  });

  it('reaches every transitively-called program', async () => {
    const rows = await callChainDownstream(h.db, estateId, P['A']);
    const names = new Set(rows.map((r) => r.program_name));
    for (const n of ['A', 'B', 'C', 'X', 'Y']) expect(names.has(n)).toBe(true);
  });

  it('reports correct depth for a linear chain', async () => {
    const rows = await callChainDownstream(h.db, estateId, P['A']);
    const depthOf = (n: string) => rows.find((r) => r.program_name === n)?.depth;
    expect(depthOf('A')).toBe(0);
    expect(depthOf('B')).toBe(1);
    expect(depthOf('C')).toBe(2);
  });
});

describe('loadEstateGraph', () => {
  it('returns nodes and edges for the force graph', async () => {
    const g = await loadEstateGraph(h.db, estateId);
    expect(g.nodes.length).toBe(5);
    expect(g.edges.length).toBe(5);
    expect(g.edges.every((e) => e.kind === 'call')).toBe(true);
  });
});

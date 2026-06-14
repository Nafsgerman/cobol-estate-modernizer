// =============================================================================
// db/lineage.ts — recursive call-chain traversal (the demo centerpiece)
// Raw SQL via Drizzle for the recursive CTE; cycle-safe via path array.
// Works identically on Aurora PG16 and Lakebase PG16.
//
// Every query is wrapped in withDbRetry: under Aurora Serverless v2 autoscaling
// a pooled connection can be closed mid-idle, and the graph route fires a burst
// of these in parallel against a cold pool. One transparent retry evicts the
// dead client and re-runs on a fresh connection instead of surfacing a 500.
// =============================================================================
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { withDbRetry } from './index';

export interface CallChainRow {
  program_id: string;
  program_name: string;
  depth: number;
  path: string[];        // program UUIDs from root -> this node
  is_cycle: boolean;
}

/**
 * Downstream call chain from a root program: every program it transitively
 * CALLs. Cycle-guarded (COBOL can have mutually recursive CALLs).
 * Direction flips by swapping source_id/target_id in the JOINs.
 */
export async function callChainDownstream(
  db: NodePgDatabase<any>,
  estateId: string,
  rootProgramId: string,
  maxDepth = 25,
): Promise<CallChainRow[]> {
  const res = await withDbRetry(() =>
    db.execute(sql`
    WITH RECURSIVE chain AS (
      SELECT
        p.id                AS program_id,
        p.program_id        AS program_name,
        0                   AS depth,
        ARRAY[p.id]         AS path,
        false               AS is_cycle
      FROM program p
      WHERE p.id = ${rootProgramId} AND p.estate_id = ${estateId}

      UNION ALL

      SELECT
        tgt.id,
        tgt.program_id,
        c.depth + 1,
        c.path || tgt.id,
        tgt.id = ANY(c.path)          AS is_cycle
      FROM chain c
      JOIN dependency d
        ON d.estate_id   = ${estateId}
       AND d.kind        = 'call'
       AND d.source_type = 'program'
       AND d.target_type = 'program'
       AND d.source_id   = c.program_id
      JOIN program tgt ON tgt.id = d.target_id
      WHERE NOT c.is_cycle              -- stop expanding once a cycle is hit
        AND c.depth < ${maxDepth}
    )
    SELECT program_id, program_name, depth, path, is_cycle
    FROM chain
    ORDER BY depth, program_name;
  `),
  );
  return res.rows as CallChainRow[];
}

// ---------- force-graph loader (nodes + edges for one estate) ---------------
export interface GraphNode { id: string; type: string; label: string }
export interface GraphEdge { source: string; target: string; kind: string }

/** One round-trip payload for the D3 force-graph. */
export async function loadEstateGraph(db: NodePgDatabase<any>, estateId: string) {
  const nodes = await withDbRetry(() =>
    db.execute(sql`
    SELECT id, 'program'::text  AS type, program_id AS label FROM program  WHERE estate_id = ${estateId}
    UNION ALL
    SELECT id, 'copybook'::text AS type, name       AS label FROM copybook WHERE estate_id = ${estateId}
  `),
  );
  const edges = await withDbRetry(() =>
    db.execute(sql`
    SELECT source_id AS source, target_id AS target, kind::text AS kind
    FROM dependency WHERE estate_id = ${estateId}
  `),
  );
  return {
    nodes: nodes.rows as GraphNode[],
    edges: edges.rows as GraphEdge[],
  };
}

/** Rules for a clicked node — drives "click node -> its extracted rules". */
export async function rulesForProgram(db: NodePgDatabase<any>, programId: string) {
  const res = await withDbRetry(() =>
    db.execute(sql`
    SELECT id, statement, category, location, confidence
    FROM business_rule
    WHERE program_id = ${programId}
    ORDER BY category, confidence DESC NULLS LAST
  `),
  );
  return res.rows;
}

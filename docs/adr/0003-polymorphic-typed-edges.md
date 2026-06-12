# 3. Polymorphic typed edges for the estate graph

Date: 2026-06-12
Status: Accepted

## Context
The graph connects heterogeneous node types (program, copybook, data_element)
with typed relationships (call, copy, uses_data, ...). Two designs were viable:

1. **Per-pair edge tables** (program_calls_program, program_copies_copybook,
   ...). Real foreign keys, but a combinatorial explosion of tables and a union
   across all of them for any "load the whole graph" query.
2. **Single polymorphic edge table** — `(source_type, source_id, target_type,
   target_id, kind)`. One table, one index strategy, trivial full-graph load.

PostgreSQL cannot express a foreign key whose target table varies by row, so
option 2 forfeits referential integrity on `source_id` / `target_id`.

## Decision
Use a single polymorphic `dependency` table. Integrity is enforced at the
application layer (edges are only written alongside verified nodes within one
transaction) and supported by a uniqueness constraint on the full edge tuple
plus directional indexes (`idx_dep_out`, `idx_dep_in`) and a partial index on
the call hot-path (`idx_dep_call`).

## Consequences
- **Gave up:** database-enforced FK integrity on edge endpoints.
- **Gained:** one-query graph load for the D3 force-graph, a uniform recursive
  CTE, and a schema that does not grow with each new relationship type.
- **Mitigation:** writes go through a repository layer that inserts nodes and
  edges in the same transaction; a `gc` query (see `lib/db/lineage.ts`) can
  detect orphaned edges. This tradeoff is deliberate, not incidental.

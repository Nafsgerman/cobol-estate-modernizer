# 5. Cycle-safe recursive call-chain traversal

Date: 2026-06-12
Status: Accepted

## Context
COBOL programs can form mutually recursive CALL graphs (A calls B, B calls A).
A naive `WITH RECURSIVE` traversal over such a graph never terminates. The
call-chain query is the demo centerpiece and runs against arbitrary uploaded
estates, so unbounded recursion is a correctness and availability risk, not a
theoretical edge case.

## Decision
Carry an explicit `path uuid[]` accumulator and an `is_cycle` flag in the
recursive CTE. A row is marked `is_cycle` when its node already appears in the
path; the recursive arm stops expanding any branch once a cycle is detected
(`WHERE NOT c.is_cycle`) and is additionally bounded by a `maxDepth` guard.
We chose the explicit path-array approach over PostgreSQL's `CYCLE` clause for
portability (ADR 0004) and because it makes the cycle visible in the result set
— the UI surfaces it, and a modernization `risk` ticket is generated from it.

## Consequences
- Traversal provably terminates on cyclic input; proven by an automated test
  (`test/lineage.test.ts`) that seeds A↔B recursion and asserts a finite,
  cycle-flagged result.
- The cycle is *surfaced as a product feature* (a re-platforming risk) rather
  than hidden — turning a correctness safeguard into user-facing value.
- `maxDepth` (default 25) is a defense-in-depth bound for pathological inputs.

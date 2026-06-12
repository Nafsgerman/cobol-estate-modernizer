# 2. Amazon Aurora PostgreSQL Serverless v2 as the primary datastore

Date: 2026-06-12
Status: Accepted

## Context
The estate model is a graph: programs, copybooks, and data elements connected by
typed dependency edges. The headline feature is recursive call-chain traversal.
We evaluated three AWS database options permitted by the hackathon:

- **DynamoDB** — excellent for known access patterns at scale, but recursive
  graph traversal requires either application-side BFS (N round-trips) or a
  secondary graph store. Adjacency queries fight the key-value model.
- **Aurora DSQL** — active-active, scale-out SQL; attractive for global write
  scale, but its Postgres surface is a subset and recursive CTE support /
  isolation semantics are still narrower than Aurora PostgreSQL.
- **Aurora PostgreSQL Serverless v2** — full Postgres 16, native `WITH
  RECURSIVE`, `jsonb`, enums, partial indexes, scales to zero-ish and up.

## Decision
Use **Aurora PostgreSQL Serverless v2 (PG16)** as the primary back end. The core
value — traversing an estate's call graph in one query with cycle protection —
maps directly onto recursive CTEs, which Aurora PostgreSQL supports first-class.

## Consequences
- The demo centerpiece (recursive call-chain) is a single DB round-trip, not an
  N+1 application loop.
- We accept that million-user write-scale (Track 3 territory) is not our axis;
  this is a B2B knowledge tool where read-heavy graph queries dominate.
- Serverless v2 autoscaling keeps idle cost low between demo sessions.

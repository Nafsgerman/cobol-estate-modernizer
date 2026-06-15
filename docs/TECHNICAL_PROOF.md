# Technical Proof

This document is for a reviewer who wants to verify *how* the system works, not
just that it runs. It states each non-obvious technical claim, points at the
code that backs it, and is explicit about what is **not** yet built. Nothing here
is aspirational unless it is labelled as such.

Repo: `github.com/Nafsgerman/cobol-estate-modernizer`

---

## 1. Recursive call-chain traversal with a cycle guard

**Claim:** the estate's full transitive call graph is walked in a single database
round-trip, and the traversal provably terminates on mutually-recursive COBOL
`CALL` graphs (A→B→A) instead of looping forever.

**Mechanism** (`lib/db/lineage.ts`, `callChainDownstream`): a `WITH RECURSIVE`
CTE carries two pieces of state down each branch — an `ARRAY[...]` accumulator of
every program id on the path so far, and an `is_cycle` boolean set when the next
node already appears in that path. The recursive arm refuses to expand any branch
that has been flagged (`WHERE NOT c.is_cycle`) and is independently bounded by a
`maxDepth` guard (default 25). Termination therefore has two guarantees: the
path-array stops a branch the moment it revisits a node, and the depth bound caps
pathological inputs even before a cycle is reached.

We chose the explicit path-array approach over PostgreSQL's native `CYCLE` clause
deliberately — it keeps the query on core PG16 features (portability, see
`docs/adr/0004`) and, more importantly, it makes the cycle a *value in the result
set* rather than something the engine silently prunes. The UI styles those nodes
as a re-platforming risk, so a correctness safeguard becomes a user-facing
feature.

**Why it matters architecturally:** the alternative on a key-value store is
application-side BFS — N round-trips per traversal. Here the graph walk is the
database's job, which is the reason Aurora PostgreSQL was chosen over DynamoDB /
Aurora DSQL (`docs/adr/0002`).

**Proof:** `test/lineage.test.ts` seeds an `A→B→C` linear chain plus a mutually
recursive `X↔Y` pair reachable from `A`, then asserts the traversal *returns* (a
broken guard hangs to the test timeout), that the result is finite and small, and
that the cycle rows are flagged. Cycle detection is not re-derived in TypeScript —
`lib/graph/reactflow.ts` consumes the CTE's `is_cycle` output as the single source
of truth.

---

## 2. Zero-secrets database auth (Vercel OIDC → RDS IAM)

**Claim:** there is no database password anywhere — not in the repo, not in env
vars, not in a secrets manager.

**Mechanism** (`lib/db/index.ts`): on Vercel, the function exchanges its OIDC
web-identity token to assume `AWS_ROLE_ARN` (`awsCredentialsProvider` from
`@vercel/functions/oidc`); locally and in CI it falls back to the AWS default
provider chain. Those credentials sign a short-lived **RDS IAM auth token** via
`@aws-sdk/rds-signer`, and that token is handed to `pg` as the connection
*password* through a function reference (`password: authToken`) — so `pg` mints a
fresh token per physical connection. RDS IAM tokens live 15 minutes; we cache for
10 to avoid re-signing on every new connection under Aurora Serverless v2
scale-to-zero churn, with a 5-minute safety margin.

**TLS:** `lib/db/ssl.ts` returns `{ rejectUnauthorized: true }` for any remote
host — the cert chain is *verified* against Node's system trust store. The
Vercel-provisioned Aurora endpoint presents a public Amazon Trust Services
certificate that chains to a root already trusted by Node, so verification needs
no bundled CA file. This is stricter than the Vercel Marketplace integration
default (`rejectUnauthorized: false`) and is a deliberate hardening of the DB hop.

**Connection lifecycle:** a single pool is memoised on `globalThis` to survive HMR
and serverless invocation reuse, capped at `max: 5` (Aurora Serverless v2 scales
to ~0 ACU when idle), and registered with `attachDatabasePool` so Vercel drains
in-flight queries on function suspend.

---

## 3. Determinism contract: the model never writes its own headline

**Claim:** the same program analysed twice yields the same verdict, and the
headline scorecards can never contradict the breakdown beneath them.

**Two-part mechanism:**

1. **`temperature: 0` at every analytical call site** — both the DB-backed path
   (`app/actions/analyze.ts`) and the stateless path (`app/actions/playground.ts`)
   set it explicitly. Same input → same tokens.

2. **The summary is derived, never trusted** (`lib/ai/summarize.ts`). The model is
   asked only for `details` (per-factor evidence). `projectSummary()` is a pure,
   total function that computes the headline from those details:
   `assess` readiness is the mean of the breakdown scores; `risk_level` is the
   *worst* individual risk actually present; `dependencies` rollups
   (direct/transitive counts, `in_cycle`) are counted off the arrays. Even if the
   model emits its own `summary`, the renderer shows the projected one. The
   scorecard is therefore a function of the data shown below it and cannot drift.

`assembleResult()` stays in a stable `{ mode, summary, details }` shape and falls
back to `{ raw }` on unparseable output, so the renderer and persistence layer are
unaffected by model variance.

---

## 4. Tested against real Postgres, not a mock

**Claim:** the recursive CTE, enums, and partial indexes are exercised exactly as
they run in production.

**Mechanism** (`test/setup/pg-harness.ts`): each suite starts a real
`postgres:16-alpine` container via Testcontainers, applies the production
`lib/db/schema.sql` *verbatim* (the same DDL Aurora runs, including the partial
call index and the deferred `last_run_id` FK), and hands back a Drizzle client.
There is no in-memory fake and no schema written specially for tests — if the DDL
or the query is wrong, the test fails the way prod would.

**Current coverage (4 tests, all in `test/lineage.test.ts`):** three on
`callChainDownstream` (terminates + flags cycle on cyclic input; reaches every
transitively-called program; correct depth on a linear chain) and one on
`loadEstateGraph` (returns the expected nodes/edges for the force graph). See §7
for what these tests pointedly do **not** cover.

---

## 5. Estate vs Playground — two deliberately separate surfaces

These are not two views of one thing; they are different architectures and must
stay that way.

**Estate** (`app/actions/analyze.ts` + `components/graph/AnalysisPanel.tsx`) is
DB-backed and stateful. An analysis opens an `analysis_run` row
(`pending → streaming → complete/error`), streams tokens to the client *and*
records the full lineage: token counts and cost on the run, `business_rule` and
`ticket` rows for extract mode, and a `program.last_run_id` pointer. The
`dependencies` mode is fed resolved graph context from the recursive CTE so the
model reconciles source against what the graph already knows, rather than
re-deriving the call graph from text.

**Playground** (`app/actions/playground.ts` + `components/playground/Playground.tsx`)
is stateless and ephemeral — nothing touches the estate tables. It runs a triage
cascade first: a cheap Haiku pass returns a verdict, and a `blocking` verdict ends
the stream *before* the expensive Sonnet call ever fires. It is the paste-and-go
demo surface; the Estate is the product.

Both paths share the same determinism contract (§3) and the same IAM-auth client
(§2) — the separation is about persistence and intent, not duplicated infra.

---

## 6. Where v0 was used

Honestly and narrowly: **v0 generated the initial Next.js scaffold only.** The
data layer, the recursive lineage query, the IAM/OIDC connection, the determinism
projection, the streaming Server Actions, and the graph rendering are
hand-written. v0 is credited for what it did (bootstrapping the app shell) and not
for anything it didn't.

---

## 7. Honest limitations

These are real and intentionally surfaced rather than hidden.

- **Blind-trusted DB rows.** `callChainDownstream` returns
  `res.rows as CallChainRow[]` — a TypeScript cast, not a runtime-validated shape.
  The query and schema are pinned together by the testcontainers DDL, but a
  malformed row from a future schema change would not be caught at the boundary.
  A Zod (or equivalent) parse at the `db.execute` seam is the correct fix.

- **Test coverage is narrow.** The 4 tests exercise the lineage/traversal layer
  only. There is **no** automated coverage of the four AI modes, the
  `projectSummary` derivation, the IAM auth path, the streaming Server Actions, or
  the persistence writes. The determinism contract (§3) is enforced by code
  structure, not yet asserted by a test.

- **The build skips type validation.** `pnpm build` does not run full `tsc`; real
  type errors exist in the graph/lineage code today. The app runs, but "build is
  green" currently means "compiles and bundles," not "type-checks clean." This
  should be closed before any production claim.

- **Single-tenant.** Estates are keyed by `estate_id` throughout, but there is no
  tenant boundary, no per-user scoping, and no authorization on the graph
  endpoint — see §8.

---

## 8. Production hardening — NOT YET IMPLEMENTED

Everything in this section is a roadmap, not a current capability. It is listed so
a reviewer can see the path from prototype to product, and so nothing below is
mistaken for something that exists today.

- **Tenant isolation** *(not implemented)* — row-level security keyed on tenant,
  enforced in the DB rather than trusted from the application layer. Today
  `estate_id` scopes queries but is not an authorization boundary.

- **RBAC** *(not implemented)* — no roles, permissions, or per-user access checks.
  The graph API (`app/api/estate/[id]/graph/route.ts`) is currently unauthenticated.

- **Audit log** *(not implemented)* — `analysis_run` records *what analysis ran*,
  but there is no immutable who-did-what-when trail for access and mutations.

- **No-training / retention controls** *(not implemented)* — explicit
  zero-retention / no-training configuration on the model calls, plus a defined
  retention policy for stored source and extracted rules.

- **VPC / RDS Proxy** *(not implemented)* — place Aurora in a private subnet and
  front it with RDS Proxy for connection pooling and failover, instead of the
  current direct pooled connection.

- **Strongly-consistent / materialized graph** *(not implemented)* — the graph
  endpoint currently runs the cycle-flagged chain from every program node and
  unions the hits (cheap at hackathon scale, O(N) round-trips at real scale). A
  materialized adjacency/closure table refreshed on write is the scale answer.

- **PII sanitization** *(not implemented)* — COBOL source can embed customer data
  in literals and comments. A sanitization pass before anything is sent to the
  model or persisted is required and does not exist yet.

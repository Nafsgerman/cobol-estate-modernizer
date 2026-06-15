# COBOL Estate Advisor

> A legacy-modernization knowledge base for enterprise COBOL estates. Analyzes
> mainframe programs with Claude to extract business rules and data lineage, then
> stores them as a queryable estate graph on Amazon Aurora PostgreSQL — so teams
> can *see* how programs, copybooks, and rules connect before they re-platform.

**H0 Hackathon — Track 2 (Monetizable B2B).** Built on the v0/Vercel + AWS
Databases stack.

<!-- TODO: hero GIF of the force-graph -> click node -> rules drill-down -->

---

## Why this exists
Enterprises run billions of lines of COBOL no one fully understands anymore.
Before any modernization, someone has to answer: *what does this program do, what
calls it, and what business rules are buried inside it?* This tool turns
single-file analysis into an estate-wide, queryable graph that answers those
questions.

## What it does
- **Four analysis modes** (ported from the original [cobol-ai-advisor](https://github.com/Nafsgerman/cobol-ai-advisor)):
  Explain, Modernize, Assess, Extract — each a Claude call.
- **Estate graph** — programs, copybooks, data elements, and typed dependency
  edges, stored in Aurora PostgreSQL.
- **Recursive call-chain traversal** — one SQL query walks the full call graph
  with cycle protection; mutually-recursive COBOL CALLs are detected and surfaced
  as re-platforming risks, not silently looped.
- **Interactive lineage** — D3 force-graph; click a node to see the business
  rules extracted from it.

## Architecture
<!-- TODO: architecture diagram (also required for the H0 submission) -->

```
v0 / Next.js (Vercel)  ──►  Route Handlers + Server Actions
                               │            │
                               │            └─►  Anthropic TS SDK  ──►  Claude
                               ▼
                          Drizzle ORM
                               ▼
                 Amazon Aurora PostgreSQL Serverless v2 (PG16)
```

The engine is full Next.js — no separate Python service. Long analysis calls are
streamed to stay within serverless timeouts.

## Engineering decisions
Non-obvious choices are recorded as ADRs in [`docs/adr/`](docs/adr):
- [0002](docs/adr/0002-aurora-postgres-as-primary-datastore.md) — why Aurora PostgreSQL over DynamoDB / Aurora DSQL
- [0003](docs/adr/0003-polymorphic-typed-edges.md) — polymorphic typed edges, and the integrity tradeoff
- [0004](docs/adr/0004-pg16-portability.md) — PG16 portability (Aurora primary; one-line swap to Databricks Lakebase)
- [0005](docs/adr/0005-recursive-cte-cycle-guard.md) — cycle-safe recursive traversal, proven by test

A reviewer-facing walkthrough of how each claim is backed by code lives in
[`docs/TECHNICAL_PROOF.md`](docs/TECHNICAL_PROOF.md).

## Data model
`estate` → `program` / `copybook` / `analysis_run` / `ticket`; `data_element`
(self-referential hierarchy); `business_rule` (traced back to the run that
produced it); `dependency` (the typed-edge graph). Full DDL in
[`lib/db/schema.sql`](lib/db/schema.sql), Drizzle schema in
[`lib/db/schema.ts`](lib/db/schema.ts).

## Local development

The app authenticates to Aurora with **RDS IAM tokens minted from Vercel OIDC** —
there is no `DATABASE_URL` and no stored password. The Aurora cluster is
provisioned inside **Vercel's AWS account**, so you cannot `psql` to it directly
from a laptop. Day-to-day development therefore runs against a local Postgres for
the data layer (tests, below) and against **Vercel preview deploys** for the live
app, where OIDC supplies credentials automatically.

```bash
pnpm install

# 1. Anthropic SDK key for the analysis calls
cp .env.example .env.local        # set ANTHROPIC_API_KEY

# 2. Run the app
pnpm dev
```

Connection config is read from `PGHOST`, `PGUSER`, `PGDATABASE` (default
`postgres`), `PGPORT` (default `5432`), `AWS_REGION`, and `AWS_ROLE_ARN` — set in
the Vercel project, not committed. On Vercel these are paired with OIDC; locally,
`lib/db/index.ts` falls back to the AWS default provider chain (SSO / profile /
env), which only resolves if your credentials can reach the cluster's account.
TLS is verified against the system trust store (`rejectUnauthorized: true`); no CA
bundle file is required for the Vercel-provisioned endpoint.

## Tests
```bash
pnpm test     # spins a real Postgres 16 (testcontainers), applies schema.sql,
              # proves the recursive call-chain terminates on cyclic input
```
Requires Docker. This is the real local loop for the data layer — it exercises the
recursive CTE, enums, and partial indexes against production DDL, with no
dependency on the remote Aurora cluster.

## Stack
Next.js (App Router) · v0 · Vercel · Amazon Aurora PostgreSQL Serverless v2 ·
Drizzle ORM · Anthropic TS SDK · D3 · Vitest + Testcontainers

## Credits
Builds on [cobol-ai-advisor](https://github.com/Nafsgerman/cobol-ai-advisor)
(original Explain/Modernize/Assess/Extract prompts), re-architected for the H0
stack with the persistence + lineage layer added during the hackathon.

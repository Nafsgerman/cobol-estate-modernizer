# 4. PG16-portable schema (Aurora primary, Lakebase as a portability property)

Date: 2026-06-12
Status: Accepted

## Context
The submission targets Amazon Aurora PostgreSQL. Separately, the same codebase
should run on Databricks Lakebase (managed PostgreSQL 16) to demonstrate that the
data layer is not vendor-locked. We did not want two schemas or a translation
layer.

## Decision
Constrain the schema and queries to **core PostgreSQL 16** features only:
`gen_random_uuid()` (core since PG13), standard enums, `jsonb`, partial indexes,
and `WITH RECURSIVE` with an explicit path-array cycle guard (no dialect-specific
`SEARCH`/`CYCLE` reliance). Connection target is a single `DATABASE_URL`. No
Aurora-only functions or extensions appear anywhere in the schema or queries.

## Consequences
- Switching between Aurora and Lakebase is a connection-string change — proof
  that persistence is a swappable concern, not architecture.
- **Constraint accepted:** we forgo Aurora-specific conveniences that would lock
  us in (e.g. Aurora-only extensions).
- All H0-facing artifacts (architecture diagram, screenshots, README primary
  path) show **Aurora only**; Lakebase is documented as a portability property,
  never presented as the submission datastore.

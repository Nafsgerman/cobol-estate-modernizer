# 1. Record architecture decisions

Date: 2026-06-12
Status: Accepted

## Context
This project is a portfolio-grade engineering artifact as well as a hackathon
submission. Reviewers (hiring managers, judges) read decisions, not just code.
Undocumented tradeoffs read as accidents; documented ones read as judgement.

## Decision
We keep lightweight Architecture Decision Records (ADRs) in `docs/adr/`, one
file per significant decision, in the Nygard format. Each records context, the
decision, and consequences (including what we gave up).

## Consequences
- Every non-obvious choice (polymorphic edges, PG16 portability, TLS posture,
  recursive-CTE cycle handling) has a traceable rationale.
- New contributors — and reviewers — can reconstruct *why* in minutes.

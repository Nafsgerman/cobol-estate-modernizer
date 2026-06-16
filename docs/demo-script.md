# Demo Script — COBOL Estate Modernizer
**Track 2 · Monetizable B2B · H0 Hackathon**
*Target runtime: 2:45 — hard stop at 3:00*

---

## [0:00–0:20] The Problem (hook)

> "Enterprise banks and insurers are running $3 trillion in COBOL — right now — on
> mainframes where the average developer is 55 years old. Nobody new can read the code.
> Nobody knows what the business rules are. And nobody can migrate what they can't understand."

*Show: a wall of COBOL source — dense, comment-free, 40-year-old logic.*

> "COBOL Estate Modernizer is an AI-powered analysis platform that turns unknown legacy
> codebases into structured, auditable knowledge — automatically."

---

## [0:20–0:50] Live Demo — Playground (instant value)

*Switch to the running app at the Vercel URL.*

> "Let's start with the Playground — zero setup, paste any legacy code."

1. Paste `RECON-MASTER.cbl` into the editor.
2. **Watch the triage agent fire** — Haiku detects COBOL, checks syntax in ~1 second.
   > "A fast Haiku model gates every request — broken code never reaches the expensive model."
3. Click **Explain**.
   > "Sonnet streams a structured breakdown: purpose, complexity score, variable inventory,
   > and every business rule extracted with a precise source location."
4. Click **Assess**.
   > "Migration readiness score, effort estimate in engineer-days, risk matrix with mitigations.
   > A senior engineer used to spend a week producing this. It takes two seconds."

---

## [0:50–1:40] Live Demo — Estate Graph (the differentiator)

*Navigate to the Estate view.*

> "The Playground is stateless. The Estate is where persistence matters."

1. **Show the React Flow graph** — nodes for programs, copybooks, data elements; edges for CALL chains and COPY dependencies, laid out with dagre.
   > "Every program in the portfolio is a node. Click one."
2. Click `RECON-MASTER` → **AnalysisPanel** slides in.
3. Click **Dependencies**.
   > "This mode runs a recursive CTE against Aurora PostgreSQL — traversing the full
   > call chain, cycle-safe, returning every upstream and downstream dependency in one query."
4. **Show the highlighted blast-radius overlay** on the graph.
   > "RECON-MASTER calls RECONA, which calls RECONB, which calls back into RECONA.
   > The cycle guard terminates the traversal cleanly — no infinite loop, just a flagged edge."
5. Click **Extract**.
   > "Business rules are extracted, deduped, and persisted as first-class records in Aurora —
   > linked back to the analysis run for full lineage. Every result is auditable."

---

## [1:40–2:10] Aurora PostgreSQL — the backbone

*Show the architecture diagram or Vercel storage dashboard.*

> "The persistence layer is Amazon Aurora PostgreSQL Serverless v2 — and the integration
> goes deeper than a simple connection string."

- > "Authentication is **IAM + OIDC**: Vercel mints a federated token at deploy time;
>   the RDS Signer mints a short-lived IAM auth token per connection, cached for 10 minutes
>   against Aurora's 15-minute TTL. No static credentials. No secrets in env vars."
- > "The schema has eight entities — estate, program, copybook, data element, analysis run,
>   business rule, ticket, and a polymorphic dependency edge — all modelled in Drizzle ORM
>   with raw SQL for the recursive CTEs."
- > "Aurora Serverless v2 scales to zero between demos and to production read-load under
>   judging. That's exactly the right database for a B2B SaaS that bills per active estate."

---

## [2:10–2:35] Why this wins as a B2B product

> "The target buyer is any enterprise running a mainframe modernization program —
> banks, insurers, government agencies. The value proposition is clear:"

- > "**Week 1 of a migration project** used to be manual code archaeology. Now it's one
>   paste and five clicks."
- > "Results are **persisted and linked** — the CTO can audit every business rule, every
>   risk score, every ticket generated, back to the exact model run that produced it."
- > "**Lineage is a compliance story.** In regulated industries, 'the AI said so' isn't enough —
>   you need a chain of custody from source line to migration ticket."

---

## [2:35–2:45] Close

> "COBOL Estate Modernizer: structured AI analysis, Aurora-backed lineage, and a React Flow
> graph interface that makes 40-year-old codebases legible in minutes."

> "Built on Next.js 16, deployed on Vercel, powered by Aurora PostgreSQL Serverless v2."

*Show the live URL one final time.*

---

## Filming Notes

| Segment | Action | App state |
|---|---|---|
| 0:00 | Screen share — terminal showing raw COBOL | Static file |
| 0:20 | Switch to Vercel URL (Playground tab) | Live app |
| 0:50 | Navigate to `/estate/[id]` | Live app, estate pre-seeded |
| 1:40 | Alt-tab to architecture diagram | Mermaid PNG or slide |
| 2:10 | Return to app, show token counter in panel footer | Live app |
| 2:35 | Browser URL bar visible | Live app |

**Pre-seed the estate before filming** — run `pnpm db:seed` so RECONA↔RECONB cycle exists.
Cut at 2:45; do not exceed 3:00.

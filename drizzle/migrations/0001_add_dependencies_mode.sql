-- Adds the 5th analysis mode to the existing analysis_mode enum.
-- Non-destructive: ALTER TYPE ADD VALUE appends; existing rows untouched.
-- IF NOT EXISTS makes this safe to re-run.
--
-- Apply with:  npm run db:migrate:modes
-- (or paste into the Aurora query editor / psql)

ALTER TYPE analysis_mode ADD VALUE IF NOT EXISTS 'dependencies';

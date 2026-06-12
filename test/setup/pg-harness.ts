// test/setup/pg-harness.ts
// Spins a real PostgreSQL 16 container, applies the production schema.sql, and
// hands back a Drizzle client. We test against real Postgres (not a mock) so the
// recursive CTE, partial indexes, and enums are exercised exactly as in prod.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../lib/db/schema';

export interface Harness {
  db: NodePgDatabase<typeof schema>;
  pool: Pool;
  container: StartedPostgreSqlContainer;
  stop: () => Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();

  const pool = new Pool({ connectionString: container.getConnectionUri() });

  // Apply the production DDL verbatim — this is the source of truth, including
  // the partial call index and the deferred last_run_id FK.
  const ddl = readFileSync(resolve(__dirname, '../../lib/db/schema.sql'), 'utf8');
  await pool.query(ddl);

  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    container,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}

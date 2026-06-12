/**
 * Applies the additive enum migration using your existing IAM-auth pool.
 * No new connection logic — imports the proven `pool` from lib/db.
 *
 *   npm run db:migrate:modes
 *
 * ALTER TYPE ... ADD VALUE cannot run inside a transaction block in Postgres,
 * so we issue it directly on a pooled client (pg autocommits single statements).
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pool } from "../lib/db";

async function main() {
  const file = resolve(
    process.cwd(),
    "drizzle/migrations/0001_add_dependencies_mode.sql",
  );
  const ddl = readFileSync(file, "utf8");
  console.log("Applying: 0001_add_dependencies_mode.sql");
  await pool.query(ddl);
  console.log("✓ analysis_mode now includes 'dependencies'.");
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

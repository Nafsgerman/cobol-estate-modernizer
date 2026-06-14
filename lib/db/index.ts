/**
 * lib/db/index.ts — Aurora PostgreSQL connection (RDS IAM auth, no stored credentials)
 *
 * Auth model: Vercel OIDC federation → assume AWS_ROLE_ARN → mint a short-lived
 * RDS IAM auth token per physical connection. No password is ever stored or pulled.
 *
 * TLS: verified against the Amazon RDS global CA bundle (rejectUnauthorized: true).
 * Stricter than the Marketplace default (`rejectUnauthorized: false`), so the DB hop
 * is protected against MITM. This is the security differentiator for the estate graph.
 *
 * Resilience: Aurora Serverless v2 scales toward 0 ACU and recycles idle
 * connections. A pooled socket the server already closed surfaces as
 * "Connection terminated unexpectedly"; a cold resume can exceed the connect
 * timeout as "Connection terminated due to connection timeout". We defend with
 * keepAlive, an idle timeout below Aurora's server-side cutoff, a pool error
 * handler that evicts dead clients, and `withDbRetry` on the read paths.
 *
 * Credential source:
 *   - On Vercel  → awsCredentialsProvider (OIDC web-identity token, zero config)
 *   - Local / CI → AWS default provider chain (env vars / SSO / shared profile)
 */
import { Signer } from "@aws-sdk/rds-signer";
import { awsCredentialsProvider } from "@vercel/functions/oidc";
import { attachDatabasePool } from "@vercel/functions";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { Pool, type PoolConfig } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "./schema";
import { withDbRetry } from './retry';
export { withDbRetry };
import { sslConfig } from "./ssl"; // ⚠️ match this to your ssl.ts export (PEM string)

/* ------------------------------------------------------------------ */
/* Environment (fail fast, typed)                                      */
/* ------------------------------------------------------------------ */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const PGHOST = required("PGHOST");
const PGUSER = required("PGUSER");
const PGDATABASE = process.env.PGDATABASE ?? "postgres";
const PGPORT = Number(process.env.PGPORT ?? 5432);
const AWS_REGION = required("AWS_REGION");
const onVercel = Boolean(process.env.VERCEL);

/* ------------------------------------------------------------------ */
/* IAM auth-token signer (+ short cache)                               */
/* ------------------------------------------------------------------ */

const credentials = onVercel
  ? awsCredentialsProvider({
      roleArn: required("AWS_ROLE_ARN"),
      clientConfig: { region: AWS_REGION },
    })
  : fromNodeProviderChain();

const signer = new Signer({
  hostname: PGHOST,
  port: PGPORT,
  username: PGUSER,
  region: AWS_REGION,
  credentials,
});

// RDS IAM tokens are valid for 15 min. Cache with a safety margin so we don't
// re-sign on every new pool connection under Aurora scale-to-zero churn.
const TOKEN_TTL_MS = 10 * 60 * 1000;
let cachedToken: { value: string; expiresAt: number } | null = null;

async function authToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.value;
  const value = await signer.getAuthToken();
  cachedToken = { value, expiresAt: now + TOKEN_TTL_MS };
  return value;
}

/* ------------------------------------------------------------------ */
/* Pool (singleton across HMR / serverless invocations)                */
/* ------------------------------------------------------------------ */

const poolConfig: PoolConfig = {
  host: PGHOST,
  user: PGUSER,
  database: PGDATABASE,
  port: PGPORT,
  password: authToken, // pg invokes this per new physical connection
  ssl: sslConfig(),
  max: 5, // lean pool; Aurora Serverless v2 scales to 0 ACU
  // Recycle idle clients *before* Aurora's server-side idle cutoff, so pg closes
  // the socket rather than handing out one the server already killed.
  idleTimeoutMillis: 10_000,
  // Cold resume from low/zero ACU + TLS + IAM handshake can exceed 10s.
  connectionTimeoutMillis: 15_000,
  // Keep active sockets warm so NAT/proxy idle reaping doesn't silently drop them.
  keepAlive: true,
  keepAliveInitialDelayMillis: 5_000,
};

declare global {
  // eslint-disable-next-line no-var
  var __cobolEstatePool: Pool | undefined;
}

function createPool(): Pool {
  const p = new Pool(poolConfig);
  // An idle client killed by Aurora (scaling event, idle reap) emits 'error' on
  // the pool. pg has already removed it; without a listener the event is
  // unhandled and can crash the function. Log and let the pool move on.
  p.on("error", (err) => {
    console.error("[db pool] idle client error (evicted):", err.message);
  });
  attachDatabasePool(p); // let Vercel drain in-flight queries on suspend
  return p;
}

// Reuse one pool per instance. Assigned unconditionally (not dev-only) so a
// module re-evaluation in production can never leak a second pool.
export const pool: Pool = globalThis.__cobolEstatePool ?? createPool();
globalThis.__cobolEstatePool = pool;

/* ------------------------------------------------------------------ */
/* Retry wrapper — connection-class failures only                      */
/* ------------------------------------------------------------------ */


/**
 * Force a cold Aurora Serverless v2 instance to resume on a single connection
 * *before* a burst of parallel queries hits the pool. Without this, the first
 * graph load fires N concurrent chain queries that each try to establish a
 * connection into a paused database at once; several lose the race to the
 * connect timeout. One retried warm-up query resumes the instance, then the
 * burst runs against a live pool. Cheap (`SELECT 1`) and idempotent.
 */
export async function warmDb(): Promise<void> {
  await withDbRetry(() => pool.query("SELECT 1"));
}

/* ------------------------------------------------------------------ */
/* Drizzle                                                             */
/* ------------------------------------------------------------------ */

export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });
export { schema };

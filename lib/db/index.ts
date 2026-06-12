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
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
};

declare global {
  // eslint-disable-next-line no-var
  var __cobolEstatePool: Pool | undefined;
}

function createPool(): Pool {
  const p = new Pool(poolConfig);
  attachDatabasePool(p); // let Vercel drain in-flight queries on suspend
  return p;
}

export const pool: Pool = globalThis.__cobolEstatePool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  globalThis.__cobolEstatePool = pool; // avoid pool leaks on dev HMR
}

/* ------------------------------------------------------------------ */
/* Drizzle                                                             */
/* ------------------------------------------------------------------ */

export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });
export { schema };

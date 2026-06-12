// lib/db/ssl.ts
// Proper TLS for Aurora/RDS: verify the server certificate against AWS's
// published CA bundle instead of disabling verification. Download once:
//
//   curl -o certs/rds-global-bundle.pem \
//     https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
//
// (Commit the bundle, or fetch it in CI. It is a public root bundle.)
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PoolConfig } from 'pg';

const BUNDLE_PATH =
  process.env.RDS_CA_BUNDLE_PATH ?? resolve(process.cwd(), 'certs/rds-global-bundle.pem');

/**
 * Returns a pg SSL config that VERIFIES the Aurora cert chain.
 * Falls back to no SSL only for an explicitly-local DATABASE_URL (dev against a
 * plain local Postgres / test container), never silently for a remote host.
 */
export function sslConfig(databaseUrl = process.env.DATABASE_URL ?? ''): PoolConfig['ssl'] {
  const isLocal = /@(localhost|127\.0\.0\.1)/.test(databaseUrl);
  if (isLocal) return undefined;

  // Aurora endpoints provisioned via the Vercel integration present a PUBLIC
  // Amazon Trust Services cert (issuer "Amazon RSA 2048 Mxx"), which chains to
  // a root already in Node's trust store. Verify against system roots; the RDS
  // private-CA bundle does NOT contain these roots.
  return { rejectUnauthorized: true };
}

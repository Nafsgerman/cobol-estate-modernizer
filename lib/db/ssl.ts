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
  if (isLocal) return undefined; // local dev / testcontainers: no TLS needed

  if (!existsSync(BUNDLE_PATH)) {
    throw new Error(
      `RDS CA bundle not found at ${BUNDLE_PATH}. Download it with:\n` +
        `  curl -o certs/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`,
    );
  }

  return {
    ca: readFileSync(BUNDLE_PATH, 'utf8'),
    rejectUnauthorized: true, // verify the chain — the point of doing this right
  };
}

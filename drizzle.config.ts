// drizzle.config.ts
// Read by drizzle-kit: `drizzle-kit generate` (SQL migrations) and
// `drizzle-kit push` (direct sync). Single DATABASE_URL → Aurora or Lakebase.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Aurora Serverless v2 over public endpoint needs TLS; Lakebase too.
  // (pg respects sslmode in the URL; nothing extra needed here.)
  verbose: true,
  strict: true,
});

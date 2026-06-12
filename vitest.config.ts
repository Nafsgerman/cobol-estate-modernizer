// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests spin a real Postgres container; give them room.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',          // isolate the container lifecycle per file
    include: ['test/**/*.test.ts'],
  },
});

/**
 * Vitest config for RLS integration tests.
 *
 * This config is intentionally separate from vitest.config.ts so that:
 *   - The vi.mock('@packd/db') registered in rls-isolation.test.ts is NOT
 *     present in the worker that runs the integration tests.
 *   - The integration tests can import the real @packd/db Prisma client.
 *
 * Run via:  npm run test:integration
 * CI runs it after applying migrations + RLS policies + packd_api role setup.
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Only the integration test file — never the unit test file (which has vi.mock).
    include: ['apps/api/src/__tests__/*.integration.test.ts'],
    // Ensure each test file runs in its own worker so module state is clean.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: false },
    },
  },
})

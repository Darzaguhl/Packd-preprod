import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['apps/api/src/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['apps/api/src/**', 'packages/*/src/**'],
      exclude: ['**/*.test.ts', '**/seed.ts'],
    },
  },
})

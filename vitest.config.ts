import { defineConfig } from 'vitest/config'

/** The unit tests of the framework-free helpers under `src/lib`, plus the composer's DOM-level guards under `src/components`, which declare their own jsdom environment in a per-file docblock. Everything else here runs in node because it needs no DOM, and `src/test/setup.ts` supplies the `localStorage` the config and cache modules read. */
export default defineConfig({
  test: {
    environment: 'node',
    // Only `*.test.ts` is collected: a spec named `.test.tsx` would never run.
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts']
  }
})

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,       // Allows using `describe`, `it`, `expect` without importing them
    environment: 'node', // We are testing Node.js architecture, not a browser
    include: ['tests/**/*.test.ts'], // Only run tests in the tests/ folder
  },
});
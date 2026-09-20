import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/ui/domains/workflows/__tests__/**/*.test.ts'],
  },
});

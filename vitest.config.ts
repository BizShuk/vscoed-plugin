import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['log_doctor/test/**/*.test.ts'],
    exclude: ['node_modules/**', 'log_doctor/test/integration/**'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['log_doctor/src/**/*.ts'],
      exclude: ['log_doctor/src/extension.ts', 'log_doctor/src/providers/factory.ts'],
    },
  },
});
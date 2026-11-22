import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], testTimeout: 240000, hookTimeout: 300000, pool: 'forks', poolOptions: { forks: { singleFork: true } } },
});

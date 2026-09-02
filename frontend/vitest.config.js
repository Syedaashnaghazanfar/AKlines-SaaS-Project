import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    globals: true,
    // The default "forks" pool hangs in this sandboxed environment (process
    // spawning is restricted); the "threads" pool runs in-process instead.
    pool: 'threads',
  },
});

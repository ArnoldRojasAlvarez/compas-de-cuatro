import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts'],
    // Quitar cuando entre T-002, que es el primer ticket con tests.
    // Sin esto vitest sale con codigo 1 y la CI queda roja en un repo vacio.
    passWithNoTests: true,
  },
});
